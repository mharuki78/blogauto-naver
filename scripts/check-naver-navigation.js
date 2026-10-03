const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const vm = require("node:vm");
const { test, before, after } = require("node:test");
const { chromium } = require("playwright-core");
const { _private, verifyOpenNaverSession, naverSessionFailureStatus } = require("../src/lib/naverPublisher");

const target = "https://blog.naver.com/test-blog/postwrite";
const form = "https://blog.naver.com/PostWriteForm.naver?blogId=test-blog";
const home = "https://blog.naver.com/test-blog";
const editorHtml = '<textarea placeholder="제목"></textarea><div class="se-main-container">글쓰기</div>';
const selectors = { titleInput: "textarea[placeholder='제목']" };
const runtimeRoot = path.resolve(__dirname, "../tmp/naver-navigation-check");
let browser;
before(async () => { browser = await chromium.launch({ channel: "chrome", headless: true }); });
after(async () => { await browser?.close(); });

async function fixture(respond) {
  const context = await browser.newContext();
  const visits = [];
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (route.request().isNavigationRequest()) visits.push(url);
    await route.fulfill({ contentType: "text/html; charset=utf-8", ...respond(url) });
  });
  return { context, visits, page: await context.newPage() };
}

test("a slow post-login redirect reaches the editor without restarting navigation", async () => {
  const { context, page, visits } = await fixture((url) => url === target
    ? { body: `<script>location.replace(${JSON.stringify(home)})</script>` }
    : url === home
      ? { body: `<p>로그인 완료, 블로그를 여는 중입니다.</p><script>setTimeout(() => location.href = ${JSON.stringify(form)}, 8000)</script>` }
      : { body: editorHtml });
  try {
    const result = await _private.verifyPostWriteSession(context, page, selectors,
      { interactiveLogin: true, editorCheckTimeout: 12000, runtimeRoot }, target, () => {});
    assert.equal(result.status, "valid");
    assert.equal(result.page.url(), form);
    assert.equal(visits.filter((url) => url === target).length, 1,
      "reopening postwrite cancels the redirect and makes Chrome flash");
  } finally { await context.close(); }
});

test("an already open legacy editor for the target blog is reused", async () => {
  const { context, page, visits } = await fixture(() => ({ body: editorHtml }));
  try {
    await page.goto(form);
    const before = visits.length;
    const result = await verifyOpenNaverSession({ blogId: "test-blog", context, page, editorCheckTimeout: 10000 });
    assert.equal(result.status, "valid");
    assert.equal(result.url, form);
    assert.equal(visits.length, before, "a ready editor must not be reloaded");
  } finally { await context.close(); }
});

test("a ready editor in a second tab is preferred over the old login tab", async () => {
  const { context, page, visits } = await fixture(() => ({ body: editorHtml }));
  try {
    await page.goto(home);
    const editor = await context.newPage();
    await editor.goto(target);
    const before = visits.length;
    const result = await _private.verifyPostWriteSession(context, editor, selectors, {}, target, () => {});
    assert.ok(result.page === editor, "verification must keep the target editor tab");
    assert.equal(page.url(), home);
    assert.equal(visits.length, before);
  } finally { await context.close(); }
});

test("an authentication handoff is not treated as completed login", async () => {
  const handoff = "https://nid.naver.com/login/sso/finish";
  const { context, page } = await fixture((url) => url === handoff
    ? { body: `<p>로그인 처리 중</p><script>setTimeout(() => location.href = ${JSON.stringify(home)}, 1500)</script>` }
    : url === home ? { body: '<iframe src="/PostList.naver?blogId=test-blog"></iframe>' }
      : { body: "<p>블로그 홈</p>" });
  try {
    await page.goto(handoff);
    const result = await _private.waitForLoginComplete(page, () => {}, 5000, {}, 100);
    assert.equal(result.url, home, "authentication redirects must finish before postwrite navigation");
  } finally { await context.close(); }
});

test("a redirect to a different blog editor never confirms the target session", async () => {
  const other = "https://blog.naver.com/PostWriteForm.naver?blogId=another-blog";
  const { context, page } = await fixture((url) => url === target
    ? { body: `<script>location.replace(${JSON.stringify(other)})</script>` }
    : { body: editorHtml });
  try {
    await assert.rejects(() => _private.verifyPostWriteSession(context, page, selectors,
      { editorCheckTimeout: 10000, runtimeRoot }, target, () => {}));
  } finally { await context.close(); }
});

test("a persistent home redirect stops instead of refreshing forever", async () => {
  const { context, page, visits } = await fixture((url) => url === target
    ? { body: `<script>location.replace(${JSON.stringify(home)})</script>` }
    : { body: "<p>블로그 홈</p>" });
  try {
    await assert.rejects(() => _private.verifyPostWriteSession(context, page, selectors,
      { blogId: "test-blog", runtimeRoot, editorCheckTimeout: 7000 }, target, () => {}),
    (error) => error.code === "NAVER_POSTWRITE_UNAVAILABLE");
    assert.equal(visits.filter((url) => url === target).length, 1);
    assert.equal(page.isClosed(), false, "a failed redirect must leave the browser available");
  } finally { await context.close(); }
});

function generationSessionCheck(cache, overrides = {}, throughJob = false) {
  const source = fs.readFileSync(path.resolve(__dirname, "../src/main.js"), "utf8");
  const start = source.indexOf("async function verifyPublishSessionBeforeGeneration(");
  const end = source.indexOf("async function verifyTistorySessionBeforeGeneration(", start);
  const sandbox = {
    getAccountProfileDir: () => path.join(runtimeRoot, "profile"),
    sessionKeyFor: () => "account",
    updateStatus() {}, safeLog() {}, updateAccountSession() {}, emitAccountStore() {},
    reusableNaverSession: (key) => cache.get(key),
    activeNaverSessions: cache,
    verifyOpenNaverSession,
    checkNaverSession: async () => { throw new Error("a cached browser must be reused"); },
    naverSessionFailureStatus,
    createSessionExpiredError: _private.sessionExpiredError,
    emit() {}, readHistory: () => [], activeJob: {},
    category: "test", shouldPublish: true, tistoryPublishReady: false,
    ...overrides
  };
  if (!throughJob) return vm.runInNewContext(`${source.slice(start, end)}\nverifyPublishSessionBeforeGeneration`, sandbox);
  const closeStart = source.indexOf("async function closeNaverSession(");
  const closeEnd = source.indexOf("async function closeTistorySession(", closeStart);
  const preludeStart = source.indexOf("  let preparedNaverSession = null;");
  const preludeEnd = source.indexOf("  let resolved;", preludeStart);
  return vm.runInNewContext(`${source.slice(closeStart, closeEnd)}\n${source.slice(start, end)}
    async function runJobPrelude({runtimeRoot, account, blogId, form, settings, jobId}) {
      ${source.slice(preludeStart, preludeEnd)}
      return preparedNaverSession;
    }
    runJobPrelude`, sandbox);
}

test("generation verifies a preserved cached browser before using it", async () => {
  const { context, page, visits } = await fixture(() => ({ body: editorHtml }));
  const cache = new Map([["account", { context, page }]]);
  try {
    await page.goto(home);
    const check = generationSessionCheck(cache);
    const result = await check({ runtimeRoot, account: { id: "account" }, blogId: "test-blog", form: {}, settings: {}, jobId: "test" });
    assert.equal(result.page.url(), target, "generation must wait for the target editor, even when Chrome is cached");
    assert.ok(visits.includes(target));
    assert.ok(cache.get("account").context === context);
  } finally { await context.close(); }
});

test("generation retains a failed login window for the next session check", async () => {
  const { context, page } = await fixture(() => ({ body: "<p>로그인 처리 중</p>" }));
  const cache = new Map();
  const preparedSession = { context, page, browserProfileDir: path.join(runtimeRoot, "profile"), postWriteUrl: target };
  try {
    const check = generationSessionCheck(cache, {
      checkNaverSession: async () => ({ status: "unknown", reason: "editor unavailable", page, preparedSession })
    });
    await assert.rejects(() => check({ runtimeRoot, account: { id: "account" }, blogId: "test-blog", form: {}, settings: {}, jobId: "test" }),
      (error) => error.code === "SESSION_EXPIRED");
    assert.ok(cache.get("account")?.context === context, "a kept-open profile must retain its context for retry");
    assert.equal(page.isClosed(), false);
  } finally { await context.close(); }
});

test("the job failure handler also preserves the interactive login window", async () => {
  const { context, page } = await fixture(() => ({ body: "<p>로그인 처리 중</p>" }));
  const cache = new Map();
  const preparedSession = { context, page, browserProfileDir: path.join(runtimeRoot, "profile"), postWriteUrl: target };
  try {
    const run = generationSessionCheck(cache, {
      checkNaverSession: async () => ({ status: "unknown", reason: "editor unavailable", page, preparedSession })
    }, true);
    const result = await run({ runtimeRoot, account: { id: "account" }, blogId: "test-blog", form: {}, settings: {}, jobId: "test" });
    assert.equal(result.status, "session_expired");
    assert.equal(page.isClosed(), false, "the job catch must leave manual login available");
    assert.ok(cache.get("account")?.context === context);
  } finally { await context.close(); }
});
