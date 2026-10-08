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
const writeRedirect = "https://blog.naver.com/test-blog?Redirect=Write&categoryNo=1";
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

test("a legacy editor with a Write redirect query is still reused", async () => {
  const { context, page, visits } = await fixture(() => ({ body: editorHtml }));
  try {
    const legacyWrite = `${form}&Redirect=Write`;
    await page.goto(legacyWrite);
    const before = visits.length;
    const result = await verifyOpenNaverSession({ blogId: "test-blog", context, page, editorCheckTimeout: 2500, runtimeRoot });
    assert.equal(result.status, "valid");
    assert.equal(result.url, legacyWrite);
    assert.equal(visits.length, before, "a ready legacy editor must not be replaced");
  } finally { await context.close(); }
});

test("Naver frameset rewriting postwrite to Redirect=Write still confirms its editor", async () => {
  const { context, page, visits } = await fixture((url) => url === form
    ? { body: editorHtml }
    : { body: `<iframe name="mainFrame" style="width:100%;height:500px" src="${form}"></iframe>
      <script>setTimeout(() => history.replaceState('', '', '/test-blog?Redirect=Write&categoryNo=1'), 100)</script>` });
  try {
    await page.goto(target);
    await page.waitForURL(writeRedirect);
    const before = visits.length;
    const result = await verifyOpenNaverSession({ blogId: "test-blog", context, page, editorCheckTimeout: 2500, runtimeRoot });
    assert.equal(result.status, "valid");
    assert.equal(result.url, writeRedirect);
    assert.equal(visits.length, before, "the loaded Naver frame must not be reloaded");
  } finally { await context.close(); }
});

test("a write Redirect for another blog cannot authorize the target editor", async () => {
  assert.equal(_private.matchesTargetPostWriteUrl("https://blog.naver.com/another-blog?Redirect=Write", target), false);
  assert.equal(_private.matchesTargetPostWriteUrl("https://blog.naver.com/test-blog?Redirect=Update&logNo=123", target), false);
  assert.equal(_private.matchesTargetPostWriteUrl("https://blog.naver.com/test-blog?Redirect=Write&Redirect=Update", target), false);
});

test("a target frameset never accepts a different blog's editor iframe", async () => {
  const other = "https://blog.naver.com/PostWriteForm.naver?blogId=another-blog";
  const { context, page, visits } = await fixture((url) => url === other
    ? { body: editorHtml }
    : { body: `<iframe style="width:100%;height:500px" src="${other}"></iframe>` });
  try {
    await page.goto(writeRedirect);
    const before = visits.length;
    await assert.rejects(() => verifyOpenNaverSession({ blogId: "test-blog", context, page, editorCheckTimeout: 1500, runtimeRoot }));
    assert.equal(visits.length, before);
  } finally { await context.close(); }
});

test("a Redirect=Write editor is not mistaken for completed publishing", async () => {
  const { context, page } = await fixture(() => ({ body: editorHtml }));
  try {
    await page.goto(writeRedirect);
    await assert.rejects(() => _private.waitForPublishCompletion(page, { finalPublishButton: "#publish" }, () => {}, 250),
      /발행 완료 상태를 확인하지 못했습니다/);
  } finally { await context.close(); }
});

test("draft save notices and article text cannot confirm publishing on a Write screen", async () => {
  const { context, page } = await fixture(() => ({ body: `${editorHtml}<p>임시글이 저장되었습니다. 발행되었습니다라는 안내가 표시되면 확인합니다.</p>` }));
  try {
    await page.goto(writeRedirect);
    await assert.rejects(() => _private.waitForPublishCompletion(page, { finalPublishButton: "#publish" }, () => {}, 250),
      /발행 완료 상태를 확인하지 못했습니다/);
  } finally { await context.close(); }
});

test("publishing completes when the frameset changes to the published post permalink", async () => {
  const published = "https://blog.naver.com/test-blog/224123456";
  const { context, page } = await fixture((url) => url === form ? { body: editorHtml }
    : url.includes("PostView.naver") ? { body: "<p>게시글 내용</p>" }
      : { body: `<iframe style="width:100%;height:500px" src="${form}"></iframe>
        <script>setTimeout(() => {
          document.querySelector('iframe').src = '/PostView.naver?blogId=test-blog&logNo=224123456';
          history.replaceState('', '', '/test-blog/224123456');
        }, 700)</script>` });
  try {
    await page.goto(writeRedirect);
    await _private.waitForPublishCompletion(page, { finalPublishButton: "#publish" }, () => {}, 2500);
    assert.equal(page.url(), published, "a write frame must not report success before switching to its published post");
  } finally { await context.close(); }
});

test("navigation failure logs preserve routing fields without authentication tokens", async () => {
  const { context, page } = await fixture(() => ({ body: "<p>화면 이동 중</p>" }));
  const logs = [];
  try {
    await page.goto("https://blog.naver.com/test-blog?Redirect=Update&token=private-token");
    await assert.rejects(() => _private.verifyPostWriteSession(context, page, selectors,
      { runtimeRoot, editorCheckTimeout: 250 }, target, (message) => logs.push(message)));
    assert.ok(logs.some((message) => message.includes("Redirect=Update")));
    assert.ok(logs.every((message) => !message.includes("private-token")));
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

test("generation always requests fresh session evidence even with an old cached browser", async () => {
  const { context, page, visits } = await fixture(() => ({ body: editorHtml }));
  const cache = new Map([["account", { context, page }]]);
  try {
    await page.goto(home);
    const check = generationSessionCheck(cache,{checkNaverSession:async options=>verifyOpenNaverSession({...options,preparedContext:context,preparedPage:page})});
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
    assert.equal(cache.has('account'),false,"desktop connection checks must not retain Playwright contexts");
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
    assert.equal(cache.has('account'),false);
  } finally { await context.close(); }
});
