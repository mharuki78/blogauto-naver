import { listJobs } from "../_lib/jobs";

export const runtime = "nodejs";

export async function GET() {
  try {
    return Response.json({ jobs: await listJobs() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 503 });
  }
}
