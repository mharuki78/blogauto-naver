const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");

const runnerPath = path.resolve(__dirname, "../src/lib/codexRunner.js");
const source = fs.readFileSync(runnerPath, "utf8");
const title = "리드줄 잡는 날, Himawari 0424를 산책 가방으로 고를까?";
const reference = {
  sourceId: "reference-1", userProvided: true,
  url: "https://example.com/brand", title: "Himawari 데일리 가방",
  excerpt: "Himawari No.0424는 강아지 모양 장식이 있는 검은색 산책 소품 가방입니다. ".repeat(6),
  relevance: { score: 20, topicMatchedTerms: ["himawari"] }
};
// The exact model and physical product type are present; optional specifications are not.
const research = {
  status: "PASS", searchNeed: "light", factBased: true, finalTitle: title,
  productIdentity: {
    modelCode: "0424", productType: "가방", visualMotif: "강아지 모양 장식",
    intendedUse: "산책 소품 수납", evidenceSourceIds: [reference.sourceId], uncertainty: "정확한 치수는 미확인"
  },
  topicThesis: "산책 소지품과 사용 동선을 기준으로 가방 선택을 돕는다.",
  confirmedFacts: ["브랜드 홈페이지에 No.0424 모델이 소개되어 있다."],
  usableSources: [{ sourceId: reference.sourceId, url: reference.url }],
  coreQuestions: ["산책 소지품의 사용 순서는 어떻게 정할까?"],
  mustCover: ["소지품 사용 순서와 일상적인 선택 기준"],
  writerContract: {
    mustNotDo: ["미확인 포켓 수·치수·착용 성능을 단정하지 않는다."]
  }
};
const writer = {
  status: "success", failureReason: "", title,
  article: "[SECTION - 산책 준비물 순서]\nHimawari 0424를 살펴볼 때 먼저 평소 챙기는 물건을 정리해 보세요. 배변봉투와 물병 등 자주 꺼내는 물건부터 사용 순서를 정하면 가방을 살펴볼 기준이 명확해집니다.",
  tags: ["강아지산책", "Himawari"], bodyImages: [], titleImagePath: ""
};
const passingReview = {
  status: "PASS", failureReason: "", titleReviewPass: true,
  articleAnswersTitle: true, topicPreserved: true, factualityPass: true,
  productIdentityPass: true,
  currentBridgePass: true, sourceUsePass: true, bodyQualityPass: true,
  imageContractPass: true, riskExpressionPass: true, writerContractPass: true,
  readerFacingArticlePass: true, noResearchProcessNarrationPass: true,
  publishable: true
};

async function simulate(reviews, overrides = {}) {
  const jobDir = fs.mkdtempSync(path.join(os.tmpdir(), "blogauto-completion-"));
  const calls = [];
  let reviewIndex = 0;
  const sandbox = {
    module: { exports: {} }, require: createRequire(runnerPath),
    __dirname: path.dirname(runnerPath), process, console, Buffer, URL,
    mockedTask: async (task) => {
      calls.push(task);
      if (task.resultFileName === "research-title-result.json") return structuredClone({ ...research, ...overrides });
      if (task.resultFileName === "writer-contract-result.json") {
        return { status: "failed", failureReason: "제품별 크기·수납 근거 부족으로 글을 작성할 수 없다." };
      }
      if (task.resultFileName === "agent-result.json") return structuredClone(writer);
      if (task.resultFileName === "main-review-result.json") return structuredClone(reviews[Math.min(reviewIndex++, reviews.length - 1)]);
      throw new Error(`Unexpected agent task: ${task.resultFileName}`);
    }
  };
  vm.runInNewContext(`${source}\nrunCodexTask = mockedTask;`, sandbox, { filename: runnerPath });
  try {
    const result = await sandbox.module.exports.runCodexGeneration({
      topicMode: "manual", topic: "강아지 산책에 어울리는 Himawari 0424",
      category: "패션", jobDir, runtimeRoot: jobDir,
      searchResults: [reference], sourceQuality: { status: "usable" },
      includeTitleImage: false, maxBodyImages: 0
    });
    return { result, calls };
  } finally {
    fs.rmSync(jobDir, { recursive: true, force: true });
  }
}

async function main() {
  for (const status of ["REVISION", "BLOCK", "PASS"]) {
    const { result, calls } = await simulate([{
      ...passingReview, status, bodyQualityPass: false, publishable: false,
      failureReason: "제품별 사양이 부족하고 일반적인 선택 조언이 많다."
    }]);
    assert.equal(result.status, "success", "Editorial-only objections must not stop the article");
    assert.equal(result.title, title);
    assert.equal(result.article, writer.article);
    assert.equal(result.mainReviewResult.advisoryOnly, true);
    assert.equal(result.mainReviewResult.status, status, "Keep the real review verdict for diagnostics");
    assert.equal(calls.filter((call) => call.resultFileName === "writer-contract-result.json").length, 0);
    const writers = calls.filter((call) => call.resultFileName === "agent-result.json");
    assert.equal(writers.length, 1, "The screenshot scenario must finish on the first Writer attempt");
    assert.ok(writers[0].prompt.includes("Stable everyday tips"));
    assert.ok(!writers[0].prompt.includes("Failure is a normal valid output"));
    assert.ok(!writers[0].prompt.includes("Do not write a fresh generic article from prior knowledge"));
  }

  const falseClaimReview = { ...passingReview, status: "BLOCK", factualityPass: false, failureReason: "근거 없는 방수 성능 단정을 삭제하세요." };
  const repaired = await simulate([falseClaimReview, passingReview]);
  assert.equal(repaired.result.status, "success");
  assert.equal(repaired.calls.filter((call) => call.resultFileName === "agent-result.json").length, 2);
  assert.ok(repaired.calls.find((call) => call.promptFileName === "prompt-retry-2.txt").prompt.includes("방수 성능"));
  const unresolved = await simulate([falseClaimReview]);
  assert.equal(unresolved.result.status, "failed", "Do not publish actual unsupported claims as advisory");
  const identityErrorReview = {
    ...passingReview, status: "BLOCK", productIdentityPass: false,
    failureReason: "No.0424를 살아 있는 강아지처럼 묘사하고 가방 대신 산책 조언을 중심에 뒀습니다."
  };
  const identityBlocked = await simulate([identityErrorReview]);
  assert.equal(identityBlocked.result.status, "failed", "A wrong product identity must never become an advisory-only issue");
  assert.equal(identityBlocked.calls.filter((call) => call.resultFileName === "agent-result.json").length, 2);
  assert.ok(identityBlocked.calls.find((call) => call.promptFileName === "prompt-retry-2.txt").prompt.includes("살아 있는 강아지"));
  const missingIdentity = await simulate([passingReview], { productIdentity: null });
  assert.equal(missingIdentity.result.status, "failed", "A named product cannot publish without a grounded identity");
  assert.equal(missingIdentity.calls.filter((call) => call.resultFileName === "agent-result.json").length, 0);
  const wrongModel = await simulate([passingReview], {
    productIdentity: { ...research.productIdentity, modelCode: "0423" }
  });
  assert.equal(wrongModel.result.status, "failed", "Details from another model must stop before writing");
  assert.equal(wrongModel.calls.filter((call) => call.resultFileName === "agent-result.json").length, 0);
  const strict = await simulate([passingReview], { searchNeed: "strict" });
  assert.equal(strict.result.status, "failed");
  assert.ok(strict.calls.some((call) => call.resultFileName === "writer-contract-result.json"));
  console.log("Practical completion checks passed: sparse reference, first-attempt completion, advisory review, factual repair, strict-topic boundary.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
