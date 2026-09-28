const assert = require("node:assert/strict");
const http = require("node:http");
const { collectReferenceSources, normalizeReferenceUrls, summarizeSourceQuality } = require("../src/lib/search");
const { _private: codexPrivate } = require("../src/lib/codexRunner");

async function main() {
  assert.deepEqual(normalizeReferenceUrls("https://example.com/post#section\nhttps://example.com/post"), ["https://example.com/post"]);
  assert.throws(() => normalizeReferenceUrls("file:///C:/secret.txt"), /http 또는 https/);
  assert.throws(() => normalizeReferenceUrls("https://dict.naver.com/dict.search?query=bag"), /사용할 수 없는/);
  assert.throws(() => normalizeReferenceUrls(Array.from({ length: 6 }, (_, index) => `https://example.com/${index}`)), /최대 5개/);

  const server = http.createServer((request, response) => {
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(request.url === "/article"
      ? `<html><head><title>히마와리 가방 실제 후기</title></head><body><article>${"히마와리 가방의 수납 공간과 착용 방법을 직접 살펴봤습니다. ".repeat(8)}</article></body></html>`
      : "<html><body>본문 없음</body></html>");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const sources = await collectReferenceSources(`${base}/article\n${base}/empty`, {
      topic: "히마와리 가방 수납",
      keyword: "히마와리",
      searchNeed: "normal"
    });
    assert.equal(sources.length, 1);
    assert.equal(sources[0].provider, "user-reference");
    assert.equal(sources[0].title, "히마와리 가방 실제 후기");
    assert.equal(sources[0].userProvided, true);
    assert.ok(sources[0].excerpt.includes("수납 공간"));
    assert.equal(summarizeSourceQuality(sources, "manual", { topic: "히마와리 가방 수납" }).status, "usable");
    const ranked = codexPrivate.compactSearchResultsForPrompt([
      { sourceId: "search-1", title: "일반 검색", url: "https://example.com/search", relevance: { score: 100 } },
      sources[0]
    ], { maxResults: 1 });
    assert.equal(ranked[0].sourceId, "reference-1");
    assert.equal(ranked[0].userProvided, true);
    await assert.rejects(() => collectReferenceSources(`${base}/empty`), /본문을 읽지 못했습니다/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  console.log("Reference URL collection checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
