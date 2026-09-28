const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { chromium } = require("playwright-core");
const publisher = require("../src/lib/naverPublisher")._private;
const runner = require("../src/lib/codexRunner")._private;

async function main() {
  const first = "사진 뒤에도 실제 본문이 남아야 합니다. 준비물과 사용 순서를 설명하는 문단입니다.";
  const second = "두 번째 사진 뒤에 들어갈 문단으로 제품 사진과 별도로 충분한 설명을 전달하고 첫 입력이 사라져도 복구합니다.";
  const article = `[SECTION - 첫 번째]\n[IMAGE INSERT - 1]\n${first}\n\n[SECTION - 두 번째]\n[IMAGE INSERT - 2]\n${second}`;
  assert.equal(publisher.splitArticleBlocks(article).filter((block) => block.type === "paragraph").length, 2);
  assert.ok(runner.writerOutputIssueReason({ status: "success", article: "[SECTION - 소제목]\n[IMAGE INSERT - 1]", tags: ["태그"] }));
  assert.equal(runner.writerOutputIssueReason({ status: "success", article, tags: ["태그"] }), "");

  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<button id="outside">사진 설정</button><iframe style="width:100%;height:700px"></iframe>');
    const frame = page.frames().find((item) => item !== page.mainFrame());
    await frame.setContent(`<style>.se-component{min-height:45px;margin:12px}.se-module-text{min-height:30px;width:650px}p{min-height:25px}</style>
      <div class="se-title" contenteditable="true">제목만으로 본문 검증을 통과하면 안 됩니다</div>
      <div class="se-component se-image" data-compid="one" tabindex="0"><button>AI 이미지 설정</button></div>
      <div class="se-component se-text"><div class="se-section-text"><div class="se-module-text" contenteditable="true" id="first"><p><br></p></div></div></div>
      <div class="se-component se-image" data-compid="two" tabindex="0"><button>AI 이미지 설정</button></div>
      <div class="se-component se-text"><div class="se-section-text"><div class="se-module-text" contenteditable="true" id="second"><p><br></p></div></div></div>`);
    const selectors = { bodyEditor: ".se-section-text .se-module-text" };
    await page.locator("#outside").click();
    await publisher.insertVerifiedBodyParagraph(page, selectors, first, {}, () => {}, frame.locator('[data-compid="one"]'));
    assert.ok((await frame.locator("#first").innerText()).includes("실제 본문"));
    assert.equal((await frame.locator("#second").innerText()).trim(), "");
    await frame.locator("#second").evaluate((node) => node.addEventListener("beforeinput", (event) => event.preventDefault(), { once: true }));
    await page.locator("#outside").click();
    await publisher.insertVerifiedBodyParagraph(page, selectors, second, {}, () => {}, frame.locator('[data-compid="two"]'));
    await publisher.verifyArticleBodyPresent(page, article);
    assert.equal((await frame.locator("#second").innerText()).split(second).length - 1, 1, "Recovery must not duplicate a paragraph");

    await frame.locator("#first").evaluate((node) => { node.innerHTML = "<p><br></p>"; });
    await assert.rejects(() => publisher.verifyArticleBodyPresent(page, article), /누락/);
    await publisher.repairExistingDraftBody(page, selectors, { article, bodyImages: [{ sequence: 1 }, { sequence: 2 }] }, () => {});
    await publisher.verifyArticleBodyPresent(page, article);
    assert.ok((await frame.locator("#first").innerText()).includes("실제 본문"));
    assert.equal((await frame.locator("#second").innerText()).split(second).length - 1, 1);
  } finally {
    await browser.close();
  }

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "blogauto-reference-check-"));
  try {
    const referencePath = path.resolve(__dirname, "../src/assets/app-icon.png");
    const options = { jobDir: temp, runtimeRoot: temp, includeTitleImage: true, maxBodyImages: 10, referenceImagePaths: [referencePath] };
    const writer = { title: "제품", titleImagePrompt: "제품 이미지", titleImageText: ["제품", "설명"], bodyImages: [{ sequence: 1, sectionHeading: "제품", prompt: "제품의 형태를 보존하는 장면" }] };
    const mismatched = { status: "success", titleImagePath: "generated.png", titleImageVerified: true, bodyImages: [{ ...writer.bodyImages[0], path: "body.png", summaryVerified: true }] };
    assert.match(runner.imageWorkerContractIssueReason(mismatched, writer, options), /일치/);
    const matched = { ...mismatched, titleReferenceMatchVerified: true, titleReferenceImagePathsUsed: [referencePath], bodyImages: mismatched.bodyImages.map((image) => ({ ...image, referenceMatchVerified: true, referenceImagePathsUsed: [referencePath] })) };
    assert.equal(runner.imageWorkerContractIssueReason(matched, writer, options), "");
    assert.ok(runner.referenceImageIssueReason({ referenceMatchVerified: true, referenceImagePathsUsed: ["invented.jpg"] }, options));
    assert.equal(runner.pendingImageWriterResult(writer, mismatched, options).bodyImages.length, 1);
    assert.equal(runner.pendingImageWriterResult(writer, matched, options).bodyImages.length, 0);
    const fallback = runner.buildReferenceImageFallback(writer, options);
    assert.equal(fallback.titleImagePath, referencePath);
    assert.equal(fallback.bodyImages[0].path, referencePath);
    assert.equal(fallback.titleImageVerified, false, "Original references must not be claimed as AI summary images");
    const prompt = runner.buildImageWorkerPrompt({ ...options, writerResult: writer });
    assert.ok(prompt.includes("Reference identity has priority"));
    assert.ok(prompt.includes("animal-shaped heads/feet/tails/pompoms"));
    const style = runner.buildImageStylePrompt(options);
    assert.ok(style.includes("actual product first"));
    assert.ok(!style.includes("Describe visual style only"));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
  console.log("Body/reference checks passed: real Chrome iframe input, lost-input recovery, draft repair, empty-body rejection, reference validation and original-photo fallback.");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
