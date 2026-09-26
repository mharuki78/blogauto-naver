import { loadJob, saveJob } from "../../../_lib/jobs";

export const runtime = "nodejs";

export async function POST(request, { params }) {
  const input = await request.json().catch(() => ({}));
  if (input.confirmedNoPublication !== true) return Response.json({ error: "네이버에 글이 발행되지 않았는지 먼저 확인해 주세요." }, { status: 400 });
  try {
    const { id } = await params;
    const job = await loadJob(id);
    if (!job) return Response.json({ error: "작업을 찾을 수 없습니다." }, { status: 404 });
    const stale = job.status === "publishing" && Date.now() - Date.parse(job.publishAttemptAt || "") > 15 * 60 * 1000;
    if (job.status !== "publish_review_required" && !stale) return Response.json({ error: "재시도를 준비할 수 없는 상태입니다." }, { status: 409 });
    job.status = "draft";
    job.publishError = "";
    job.updatedAt = new Date().toISOString();
    await saveJob(job);
    return Response.json({ job });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
