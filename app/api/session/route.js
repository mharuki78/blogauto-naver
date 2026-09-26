import { chromium } from "playwright-core";
import { browserbaseClient, createBrowserSession, releaseBrowserSession } from "../_lib/browser";

export const runtime = "nodejs";
export const maxDuration = 700;

export async function POST(request) {
  const input = await request.json().catch(() => ({}));
  const blogId = String(input.blogId || "").trim();
  const existingContextId = String(input.contextId || "").trim();
  if (!/^[a-zA-Z0-9_-]{3,50}$/.test(blogId)) return Response.json({ error: "블로그 ID를 확인해 주세요." }, { status: 400 });
  let client;
  try { client = browserbaseClient(); }
  catch (error) { return Response.json({ error: error.message }, { status: 503 }); }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (type, data) => controller.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`));
      let session;
      let browser;
      try {
        const contextId = existingContextId || (await client.contexts.create({ name: `naver-${crypto.randomUUID()}` })).id;
        session = await createBrowserSession(client, contextId);
        browser = await chromium.connectOverCDP(session.connectUrl);
        const context = browser.contexts()[0];
        const page = context.pages()[0] || await context.newPage();
        await page.goto("https://nid.naver.com/nidlogin.login", { waitUntil: "domcontentloaded", timeout: 45000 });
        const debug = await client.sessions.debug(session.id);
        send("ready", { contextId, liveViewUrl: debug.debuggerFullscreenUrl });
        const deadline = Date.now() + 9 * 60 * 1000;
        while (Date.now() < deadline && !request.signal.aborted) {
          const cookies = await context.cookies("https://naver.com");
          if (cookies.some((cookie) => cookie.name === "NID_AUT" && cookie.value)) {
            send("complete", { contextId, message: "네이버 로그인 세션을 저장했습니다." });
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
        send("timeout", { message: "로그인 대기 시간이 끝났습니다. 다시 연결해 주세요." });
      } catch (error) {
        send("error", { message: error.message || "클라우드 브라우저를 열 수 없습니다." });
      } finally {
        if (session) await releaseBrowserSession(client, session.id, browser);
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform" } });
}
