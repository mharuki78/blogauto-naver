import { chromium } from "playwright-core";
import { z } from "zod";
import { createRequire } from "node:module";
import { browserbaseClient, createBrowserSession, releaseBrowserSession } from "../_lib/browser";
import { loadJob, saveJob } from "../_lib/jobs";

const require = createRequire(import.meta.url);
const { publishToNaver } = require("../../../src/lib/naverPublisher.js");

export const runtime = "nodejs";
export const maxDuration = 700;

const inputSchema = z.object({
  jobId: z.string().uuid(),
  contextId: z.string().min(3).max(150),
  visibility: z.enum(["public", "private"]).default("public"),
});

export async function POST(request) {
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "작업 또는 로그인 세션 정보가 올바르지 않습니다." }, { status: 400 });
  let client;
  let session;
  let browser;
  let job;
  try {
    job = await loadJob(parsed.data.jobId);
    if (!job) return Response.json({ error: "작업을 찾을 수 없습니다." }, { status: 404 });
    if (job.status !== "draft") return Response.json({ error: "이 작업은 발행 중이거나 발행 결과 확인이 필요합니다." }, { status: 409 });
    client = browserbaseClient();
    session = await createBrowserSession(client, parsed.data.contextId);
    job.status = "publishing";
    job.publishAttemptAt = new Date().toISOString();
    await saveJob(job);
    browser = await chromium.connectOverCDP(session.connectUrl);
    const context = browser.contexts()[0];
    await publishToNaver({
      blogId: job.input.blogId,
      category: job.input.category,
      title: job.title,
      article: job.article,
      tags: job.tags,
      publishVisibility: parsed.data.visibility,
      publishScheduleMode: "now",
      failOnLoginRequired: true,
      preparedContext: context,
      preparedPage: context.pages()[0],
      browserProfileDir: "/tmp/blogauto-naver-browser",
      log: (message, level) => console.log(`[Naver ${level || "info"}] ${message}`),
    });
    job.status = "published";
    job.publishedAt = new Date().toISOString();
    await saveJob(job);
    return Response.json({ job });
  } catch (error) {
    if (job?.status === "publishing") {
      job.status = "publish_review_required";
      job.publishError = error.message || "발행 결과를 확인할 수 없습니다.";
      await saveJob(job).catch(() => {});
    }
    return Response.json({ error: error.message || "네이버 발행에 실패했습니다." }, { status: 500 });
  } finally {
    if (session) await releaseBrowserSession(client, session.id, browser);
  }
}
