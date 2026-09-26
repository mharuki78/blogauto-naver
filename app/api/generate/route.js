import { generateText, Output } from "ai";
import { z } from "zod";
import { saveJob } from "../_lib/jobs";

export const runtime = "nodejs";
export const maxDuration = 120;

const inputSchema = z.object({
  blogId: z.string().trim().regex(/^[a-zA-Z0-9_-]{3,50}$/),
  topic: z.string().trim().min(2).max(300),
  category: z.string().trim().max(80).default(""),
  purpose: z.string().trim().max(500).default(""),
  tone: z.string().trim().max(100).default(""),
  sourceUrls: z.array(z.string().url()).max(8).default([]),
});

const articleSchema = z.object({ title: z.string(), article: z.string(), tags: z.array(z.string()) });

function parseArticle(data) {
  if (!data.title.trim() || !data.article.trim()) throw new Error("생성된 글이 비어 있습니다. 다시 시도해 주세요.");
  return {
    title: data.title.trim().slice(0, 150),
    article: data.article.trim(),
    tags: Array.isArray(data.tags) ? data.tags.filter((tag) => typeof tag === "string").map((tag) => tag.trim()).filter(Boolean).slice(0, 15) : [],
  };
}

export async function POST(request) {
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "블로그 ID와 주제를 확인해 주세요." }, { status: 400 });
  if (!process.env.BLOB_READ_WRITE_TOKEN) return Response.json({ error: "Vercel Blob 저장소가 연결되지 않았습니다." }, { status: 503 });
  try {
    const input = parsed.data;
    const { output, usage } = await generateText({
      model: process.env.AI_GATEWAY_MODEL || "openai/gpt-4.1-mini",
      output: Output.object({ schema: articleSchema }),
      prompt: `당신은 한국어 블로그 에디터입니다. 아래 주제로 네이버 블로그 초안을 작성하세요. 본문은 읽기 쉬운 문단과 소제목을 사용하고 700~1100자로 작성하세요. 확인되지 않은 최신 수치, 법률, 일정, 가격, 혜택은 단정하지 마세요. 제공된 URL은 직접 열어 검증한 것이 아니므로 읽었다고 주장하지 마세요. 출처 확인이 필요한 내용은 본문 끝에 확인 필요라고 표시하세요. 광고성 과장과 허위 후기를 쓰지 마세요.\n주제: ${input.topic}\n카테고리: ${input.category || "없음"}\n발행 목적: ${input.purpose || "정보 제공"}\n어조: ${input.tone || "명료하고 자연스럽게"}\n사용자가 제공한 참고 URL: ${input.sourceUrls.join(", ") || "없음"}`,
      maxOutputTokens: 3500,
    });
    const article = parseArticle(output);
    const job = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      status: "draft",
      input,
      ...article,
      usage: { inputTokens: usage?.inputTokens || 0, outputTokens: usage?.outputTokens || 0 },
    };
    await saveJob(job);
    return Response.json({ job });
  } catch (error) {
    return Response.json({ error: error.message || "글 생성에 실패했습니다." }, { status: 500 });
  }
}
