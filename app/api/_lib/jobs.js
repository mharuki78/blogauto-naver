import { get, list, put } from "@vercel/blob";

function pathname(id) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("잘못된 작업 ID입니다.");
  return `jobs/${id}.json`;
}

export async function saveJob(job) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error("클라우드 작업 저장소가 연결되지 않았습니다.");
  await put(pathname(job.id), JSON.stringify(job), {
    access: "private",
    contentType: "application/json",
    allowOverwrite: true,
  });
}

export async function loadJob(id) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error("클라우드 작업 저장소가 연결되지 않았습니다.");
  const result = await get(pathname(id), { access: "private" });
  if (!result || result.statusCode !== 200) return null;
  return new Response(result.stream).json();
}

export async function listJobs() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error("클라우드 작업 저장소가 연결되지 않았습니다.");
  const { blobs } = await list({ prefix: "jobs/", limit: 50 });
  const jobs = await Promise.all(blobs.map(async (blob) => {
    try {
      const result = await get(blob.pathname, { access: "private" });
      return result?.statusCode === 200 ? await new Response(result.stream).json() : null;
    } catch { return null; }
  }));
  return jobs.filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
