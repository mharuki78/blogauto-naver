import Browserbase from "@browserbasehq/sdk";

export function browserbaseClient() {
  if (!process.env.BROWSERBASE_API_KEY) throw new Error("Browserbase API 키가 연결되지 않았습니다.");
  return new Browserbase({ apiKey: process.env.BROWSERBASE_API_KEY });
}

export async function createBrowserSession(client, contextId) {
  return client.sessions.create({
    ...(process.env.BROWSERBASE_PROJECT_ID ? { projectId: process.env.BROWSERBASE_PROJECT_ID } : {}),
    browserSettings: { context: { id: contextId, persist: true }, viewport: { width: 1366, height: 900 } },
    api_timeout: 900,
  });
}

export async function releaseBrowserSession(client, sessionId, browser) {
  await client.sessions.update(sessionId, { status: "REQUEST_RELEASE" }).catch(() => {});
  await browser?.close().catch(() => {});
}
