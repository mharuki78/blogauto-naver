import { loadJob, saveJob } from "../../_lib/jobs";

export const runtime = "nodejs";

export async function GET(_request, { params }) {
  try {
    const { id } = await params;
    const job = await loadJob(id);
    return job ? Response.json({ job }, { headers: { "Cache-Control": "no-store" } }) : Response.json({ error: "작업을 찾을 수 없습니다." }, { status: 404 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }
}

export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    const job = await loadJob(id);
    if (!job) return Response.json({ error: "작업을 찾을 수 없습니다." }, { status: 404 });
    if (job.status === "published") return Response.json({ error: "발행된 글은 수정할 수 없습니다." }, { status: 409 });
    const input = await request.json();
    const title = String(input.title || "").trim();
    const article = String(input.article || "").trim();
    if (!title || title.length > 150 || !article || article.length > 30000) {
      return Response.json({ error: "제목 또는 본문 길이를 확인해 주세요." }, { status: 400 });
    }
    job.title = title;
    job.article = article;
    job.tags = Array.isArray(input.tags) ? input.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 15) : [];
    job.updatedAt = new Date().toISOString();
    await saveJob(job);
    return Response.json({ job });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
