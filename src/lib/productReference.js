const { collectReferenceSources } = require("./search");

const DEFAULT_PRODUCT_SITE = "https://himawari.co.kr/";
const BRAND_BLOG_FALLBACKS = {
  // The brand site currently has a No.0424 reel but omits this model from its product API.
  "himawari.co.kr:0424": "https://blog.naver.com/himawari_korea/224284993796"
};

function normalizeProductModel(value) {
  const raw = String(value || "").trim().replace(/^No\.?\s*/i, "");
  if (!raw) return "";
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{1,29}$/.test(raw)) {
    throw new Error("제품 모델명은 No.를 제외한 영문·숫자·하이픈으로 입력해 주세요. 예: 0424");
  }
  return raw.toUpperCase();
}

function normalizeProductUrl(value, label = "제품 참고 사이트") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  let url;
  try { url = new URL(raw); } catch { throw new Error(`${label} 주소가 올바르지 않습니다.`); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error(`${label}은 아이디·비밀번호가 없는 http 또는 https 주소여야 합니다.`);
  }
  url.hash = "";
  return url.toString();
}

function exactModelPattern(modelCode) {
  return new RegExp(`(?:^|[^A-Za-z0-9])(?:No\\.?\\s*)?${modelCode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9])`, "i");
}

function productMatches(item, modelCode) {
  const model = String(item?.model || "").trim().replace(/^No\.?\s*/i, "").toUpperCase();
  if (model) return model === modelCode;
  return exactModelPattern(modelCode).test(String(item?.name || ""));
}

function productFromCatalog(item, modelCode, siteUrl) {
  const details = [item.name, item.tagline, item.description,
    ...(Array.isArray(item.highlights) ? item.highlights : []),
    ...Object.entries(item.specs || {}).filter(([, value]) => typeof value === "string" && value.trim()).map(([key, value]) => `${key}: ${value}`)]
    .map((value) => String(value || "").trim()).filter(Boolean);
  const sourceUrl = normalizeProductUrl(item.url || "", "상품 상세") || siteUrl;
  const excerpt = [`No.${modelCode}`, ...new Set(details)].join(" / ").slice(0, 3500);
  return {
    modelCode, siteUrl, sourceUrl, sourceId: "product-reference-1",
    title: String(item.name || `No.${modelCode}`).trim(), excerpt,
    sourceType: "site-catalog",
    candidate: { sourceId: "product-reference-1", provider: "product-site", userProvided: true,
      title: String(item.name || `No.${modelCode}`).trim(), url: sourceUrl, fetchedUrl: siteUrl,
      excerpt, contentLength: excerpt.length, relevance: 100 }
  };
}

async function fetchCatalogProduct(siteUrl, modelCode, fetchImpl) {
  const origin = new URL(siteUrl).origin;
  for (const endpoint of ["/api/products", "/products.json"]) {
    try {
      const response = await fetchImpl(new URL(endpoint, origin), {
        headers: { accept: "application/json" }, signal: AbortSignal.timeout(12000)
      });
      if (!response.ok) continue;
      const payload = await response.json();
      const products = Array.isArray(payload) ? payload : payload.products;
      if (!Array.isArray(products)) continue;
      const match = products.find((item) => productMatches(item, modelCode));
      if (match) return productFromCatalog(match, modelCode, siteUrl);
    } catch { /* Try the next public catalog endpoint. */ }
  }
  return null;
}

async function sourceFromPage(pageUrl, modelCode, siteUrl, collectSources) {
  const sources = await collectSources([pageUrl], { topic: `No.${modelCode}`, keyword: modelCode, category: "제품" });
  const candidate = sources.find((item) => exactModelPattern(modelCode).test(`${item.title || ""} ${item.excerpt || ""}`));
  if (!candidate) return null;
  const sourceUrl = pageUrl;
  return {
    modelCode, siteUrl, sourceUrl, sourceId: "product-reference-1",
    title: candidate.title || `No.${modelCode}`, excerpt: candidate.excerpt,
    sourceType: "exact-model-page",
    candidate: { ...candidate, sourceId: "product-reference-1", provider: "product-reference",
      userProvided: true, title: `${candidate.title || "제품 참고"} No.${modelCode}`,
      url: sourceUrl, relevance: 100 }
  };
}

async function resolveProductReference({ model, siteUrl = DEFAULT_PRODUCT_SITE, detailUrl = "" }, {
  fetchImpl = fetch, collectSources = collectReferenceSources, log = () => {}
} = {}) {
  const modelCode = normalizeProductModel(model);
  if (!modelCode) return null;
  const normalizedSite = normalizeProductUrl(siteUrl || DEFAULT_PRODUCT_SITE);
  const normalizedDetail = normalizeProductUrl(detailUrl, "제품 상세 URL");
  if (normalizedDetail) {
    const direct = await sourceFromPage(normalizedDetail, modelCode, normalizedSite, collectSources);
    if (direct) return direct;
    throw new Error(`제품 상세 URL에서 모델 ${modelCode}를 확인하지 못했습니다. 해당 모델의 정확한 상세 페이지를 입력해 주세요.`);
  }
  const catalog = await fetchCatalogProduct(normalizedSite, modelCode, fetchImpl);
  if (catalog) return catalog;
  const hostname = new URL(normalizedSite).hostname.replace(/^www\./, "");
  const brandBlogUrl = BRAND_BLOG_FALLBACKS[`${hostname}:${modelCode}`];
  if (brandBlogUrl) {
    log(`제품 사이트 목록에 No.${modelCode}가 없어 브랜드의 동일 모델 글을 확인합니다.`);
    try {
      const brandPost = await sourceFromPage(brandBlogUrl, modelCode, normalizedSite, collectSources);
      if (brandPost) return brandPost;
    } catch { /* Report the missing exact-model evidence below. */ }
  }
  throw new Error(`제품 참고 사이트에서 모델 ${modelCode}를 찾지 못했습니다. 제품 상세 URL을 입력하거나 사이트의 상품 등록 상태를 확인해 주세요.`);
}

module.exports = { DEFAULT_PRODUCT_SITE, normalizeProductModel, normalizeProductUrl, resolveProductReference,
  _private: { exactModelPattern, productMatches, productFromCatalog } };
