const assert = require("node:assert/strict");
const { resolveProductReference, _private: product } = require("../src/lib/productReference");
const { _private: article } = require("../src/lib/codexRunner");

async function main() {
  assert.equal(product.productMatches({ model: "No.0424", name: "히마와리 펫백" }, "0424"), true);
  assert.equal(product.productMatches({ model: "No.04240", name: "히마와리 펫백 No.0424" }, "0424"), false);
  assert.equal(product.productMatches({ name: "히마와리 가방 No.0424" }, "0424"), true);

  const fetchImpl = async () => ({ ok: true, json: async () => ({ products: [
    { name: "다른 제품 No.04240", model: "No.04240", description: "다른 모델" },
    { name: "히마와리 산책 가방 No.0424", model: "No.0424", description: "소지품을 담는 가방", url: "https://example.com/0424" }
  ] }) });
  const reference = await resolveProductReference({ model: "0424", siteUrl: "https://example.com/" }, { fetchImpl });
  assert.equal(reference.sourceType, "site-catalog");
  assert.equal(reference.sourceUrl, "https://example.com/0424");
  assert.match(reference.excerpt, /소지품을 담는 가방/);
  assert.doesNotMatch(reference.excerpt, /다른 모델/);

  const missingFetch = async () => ({ ok: true, json: async () => ({ products: [] }) });
  await assert.rejects(resolveProductReference({ model: "0424", siteUrl: "https://example.com/" }, { fetchImpl: missingFetch }), /제품 상세 URL/);
  const direct = await resolveProductReference({ model: "0424", siteUrl: "https://example.com/", detailUrl: "https://example.com/detail" }, {
    fetchImpl: missingFetch,
    collectSources: async () => [{ title: "제품 소개", url: "https://example.com/detail", excerpt: "히마와리 No.0424는 산책 가방입니다." }]
  });
  assert.equal(direct.sourceUrl, "https://example.com/detail");
  await assert.rejects(resolveProductReference({ model: "0424", siteUrl: "https://example.com/", detailUrl: "https://example.com/wrong" }, {
    fetchImpl: missingFetch,
    collectSources: async () => [{ title: "다른 제품", excerpt: "히마와리 No.04240 가방" }]
  }), /모델 0424/);

  const info = "산책 동선을 먼저 정하고 물과 배변 봉투를 챙기면 준비가 수월합니다. 작은 물건은 바로 꺼낼 수 있게 구분해서 넣는 편이 좋습니다. 귀가 후에는 사용한 물품을 분리해 정리하고 다음 외출에 필요한 물을 다시 준비해 두세요. 산책 시간과 이동 경로에 따라 챙길 양을 조절하면 가방이 지나치게 무거워지는 것을 줄일 수 있습니다.";
  const goodArticle = [
    "[SECTION - 산책 준비]", info, "[SECTION - 가방 고르기]", info,
    "[SECTION - 관련 제품 살펴보기]", "히마와리 No.0424 산책 가방은 간식과 물통을 담는 용도로 소개됩니다. https://example.com/0424"
  ].join("\n");
  assert.equal(article.informationalProductFooterIssueReason({ status: "success", article: goodArticle }, reference), "");
  assert.match(article.informationalProductFooterIssueReason({ status: "success", article: goodArticle.replace("No.0424", "No.04240") }, reference), /정확한 모델/);
  assert.match(article.informationalProductFooterIssueReason({ status: "success", article: goodArticle.replace("https://example.com/0424", "") }, reference), /상세 주소/);
  assert.match(article.informationalProductFooterIssueReason({ status: "success", article: "[SECTION - 관련 제품] No.0424 https://example.com/0424" }, reference), /두 섹션/);
  console.log("Product reference and information-first footer checks passed.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
