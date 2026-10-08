# Himawari Chrome Extension Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 현재 Himawari 앱의 기능과 데이터를 이어 쓰면서 데스크톱의 네이버·티스토리 로그인 확인과 발행을 일반 Chrome 확장 방식으로 전환한다.

**Architecture:** 현재 생성기·브랜딩·웹앱은 유지하고 별도 데스크톱 발행 어댑터를 연결한다. 계정별 Chrome 확장은 로컬 브리지를 통해 작업을 받아 입력을 검증하고, 플랫폼별 발행 결과를 기록하여 재시도에서 완료한 작업을 반복하지 않는다.

**Tech Stack:** 기존 Electron 31 / CommonJS / Node.js / Chrome Manifest V3 / `node:test` / 기존 Playwright Chrome 검사 도구. Chrome 전환을 위한 추가 npm 의존성은 없다.

**Spec:** [승인된 설계](../specs/2026-10-08-chrome-extension-migration-design.md)

## Global Constraints

- 현재 생성 흐름, 상품 정체성·사진 참조 검수, GPT-6.1 Sol 선택, Himawari 로고·앱 이름·아이콘을 보존한다.
- 실행 파일 옆 `runtime`의 설정·계정·작업 이력·이미지를 사용한다.
- 브리지는 `127.0.0.1:46321`에서만 통신한다. 연결 코드·토큰·출처·요청 크기 제한을 사용한다.
- 확장 미연결 시 다른 엔진으로 자동 발행하지 않는다. 실제 Chrome 로그인·보안 확인은 사용자가 수행한다.
- Chrome은 앱 종료나 세션 확인 실패로 닫지 않는다. 기존 Playwright 프로필의 쿠키를 복사하지 않는다.
- 기존 `src/lib/naverPublisher.js`, `tistoryPublisher.js` 및 웹 API 경로는 유지한다.
- 실제 계정에 글을 게시하는 테스트는 실행하지 않는다. 실제 문제 PC 검증과 모의 검사를 구분한다.
- 원본은 `boksajang/naverblog-extention`의 `1dd76f0e4824797559ec584fb76f63861f944949`로 고정한다.
- 새 앱 버전은 `0.2.0`, 확장 버전은 `0.3.17`, 편집기 빌드 식별자는 `20261008.1`로 한다.

## Review Focus

1. 네이버 외부 주소가 `?Redirect=Write`로 바뀌어도 같은 블로그의 편집기를 재사용한다. → Task 2 브라우저/탭 검사.
2. 최종 발행 직후 앱·확장이 끊겨도 같은 글을 다시 게시하지 않는다. → Task 1 작업 기록 + Task 4 복구 검사.
3. 계정 Blog ID를 수정·삭제한 후 이전 연결이 다른 블로그에 글을 쓰지 않는다. → Task 3 계정 변경/연결 폐기 검사.
4. 실제 참조 원본 사진에는 AI 생성 표시를 강제하지 않고 생성 이미지에는 설정을 검증한다. → Task 2 혼합 이미지 검사.
5. 사용자 설정 저장 중 교체가 실패하면 기존 파일과 보류 원고가 유효하게 남는다. → Task 5 저장 실패 검사.

## File Structure

| 파일 | 역할 |
| --- | --- |
| `src/lib/extensionBridge.js` | 로컬 HTTP 연결, 계정별 토큰, 작업 큐·기록, 취소·연결 끊김 |
| `src/lib/chromeLauncher.js`, `tistoryTarget.js` | 일반 Chrome 실행과 네이버별/티스토리 공용 대상 구분 |
| `src/lib/extensionSetup.js` | 배포 확장을 안정된 설치 폴더에 준비 |
| `src/lib/desktopPublisher.js` | 현재 데스크톱 호출 형태를 확장 세션·발행 작업으로 변환 |
| `src/lib/publishSequence.js`, `publishRecovery.js` | 플랫폼별 결과 저장·확인·중복 방지 |
| `src/lib/atomicJson.js` | 설정·계정 JSON의 임시 작성 후 교체 |
| `extension/*` | Manifest V3 연결 화면, 네이버·티스토리 입력과 완료 확인 |
| `scripts/check-extension-*.js` | 실제 HTTP 및 Chrome DOM/프레임 회귀 검사 |
| `scripts/check-desktop-publishing.js`, `check-local-state.js` | 발행 복구와 저장/사용량 조회 검사 |

---

### Task 1: 계정별 로컬 브리지와 일반 Chrome 실행

**Files:** Create `src/lib/extensionBridge.js`, `src/lib/chromeLauncher.js`, `src/lib/tistoryTarget.js`, `scripts/check-extension-bridge.js`; modify `.gitignore`.

**Interfaces:**
- `ExtensionBridge(root, port=46321)`; `start(): Promise<void>`, `stop(): void`.
- `pairCode(accountId, blogId, label, platform='naver') → {code, expiresAt, port}`.
- `snapshot(accountId) → {connected,status,loginStatus,busy,stage,reason,checkedAt}`; `request(accountId,type,payload,timeoutMs=0): Promise<Result>`; `revoke(accountId)`, `cancelAccount(accountId)`.
- Events: `status(accountId,snapshot)` and `progress(accountId,message)`. Saved tasks include ID, account, platform, state, stage, payload and result.
- `openAccountChrome(root, account, shell, options={}): Promise<LaunchSpec>`; `TISTORY_ACCOUNT_ID='tistory-shared'`, `normalizeTistoryBlogId(value): string`.

- [ ] **Step 1:** HTTP test cases: valid pairing is single use; another account token cannot finish a task or read an image; non-extension origin and non-loopback Host are denied; disconnected account rejects before enqueue; stopping/restarting a `final_publish` task preserves the uncertain attempt.
- [ ] **Step 2:** Run `node --test scripts/check-extension-bridge.js`; confirm the new modules are missing before implementation.
- [ ] **Step 3:** Adapt the pinned upstream bridge/launcher/target modules. Resolve exposed image paths within the runtime's generated/reference image folders, retain image type/size limits, and persist active-task stage before responding. Re-pairing or revocation cancels only the affected account. Use explicit launch arguments without automation flags.
- [ ] **Step 4:** Run the HTTP tests and launcher cases: two account IDs yield separate stable profile directories; URL-like Tistory ID normalizes; no cookie/Chrome preference copying; CLI helpers do not launch Chrome during unit tests.
- [ ] **Step 5:** Commit these files and ignore runtime connection/token/Chrome directories.

### Task 2: Chrome 확장 이식과 기존 로그인 회귀 방지

**Files:** Create `extension/` from the pinned upstream (manifest, background, connect HTML/CSS/JS, editor, article plan, writer, Tistory writer, draft helpers, icons); create `extension/naver-route.js`, `scripts/check-extension-editor.js`; modify `src/lib/extensionBridge.js` to preserve image-origin flags; create `UPSTREAM_NOTICES.md`.

**Interfaces:**
- Browser global `matchesNaverWriteUrl(url,blogId): boolean`, used by background tab selection/inspection and available to tests through CommonJS export.
- Existing upstream `editorCommand(command,args)`, `tistoryCommand(command,args)`, `articlePlan(article)` and `runWriter({steps,read,apply,save,checkCancelled,onProgress,requireEmpty})` retain their interfaces.
- Image payload includes `titleIsReferenceOriginal` and `bodyImages[].isReferenceOriginal`; write steps carry an `aiGenerated` boolean.
- Editor session result contains `status`, `blogId`, `editorBuild='20261008.1'`; completed results use published URL, reservation-list proof, or draft-list proof.

- [ ] **Step 1:** Tests cover direct postwrite, PostWriteForm `.naver/.nhn`, form plus Write query, outer `?Redirect=Write`, wrong blog, Update and conflicting/duplicate parameters. Assert a ready Write tab is activated without URL navigation or reload.
- [ ] **Step 2:** Run `node --test scripts/check-extension-editor.js`; verify route/extension modules are missing.
- [ ] **Step 3:** Adapt upstream extension with local branding/version and the shared Write matcher. Preserve all-frame inspection, manual login waiting, operation verification, draft saving checks, reservation checks and no automatic final-publish retry. Preserve article text/reference/footer while planning editor layout.
- [ ] **Step 4:** Pass original-image flags through bridge, steps and editor commands. Add real Chrome DOM cases for mixed original/generated images, nonempty draft preservation, input no-op retry and partial input rejection. Run tests on mocked Chrome transport plus actual Chrome frame/DOM fixtures, without a live publication.
- [ ] **Step 5:** Commit the extension, tests and pinned upstream attribution. Preserve included license/notices; do not label the whole source MIT.

### Task 3: 앱·설치 화면·데스크톱 발행 어댑터 연결

**Files:** Create `src/lib/desktopPublisher.js`, `src/lib/extensionSetup.js`; modify `src/main.js`, `src/preload.js`, `src/renderer/app.js`, `index.html`, `styles.css`, `src/lib/accountStore.js`; create `scripts/check-extension-desktop.js`.

**Interfaces:**
- Adapter exports `checkNaverSession(options)`, `verifyOpenNaverSession(options)`, `publishToNaver(options)`, `checkTistorySession(options)`, `publishToTistory(options)`, `naverSessionFailureStatus(error)`.
- Naver options contain `accountId`/`blogId`; Tistory uses the shared account with requested `tistoryBlogId`. A valid session returns `{status:'valid', preparedSession:{accountId,connection:true}, ...proof}`.
- `prepareExtension(sourceDir,destinationDir): string` copies bundled files into the same stable installation folder; no profile/token files are copied.
- IPC: `chrome:openAccount`, `tistory:open`, `extension:setup`, `extension:pair`, `tistory:pair`, `extension:connections`, `extension:cancel`, `extension:revoke`; preload exposes corresponding named methods.
- Account UI data adds `connection:snapshot` without replacing stored account/category fields.

- [ ] **Step 1:** Tests: app initial data reports disconnected despite old `sessionStatus:'valid'`; missing connection rejects before any generation call; Blog ID change/deletion revokes stale connection; old ChatGPT/model/product/reference IPC remains available.
- [ ] **Step 2:** Run `node --test scripts/check-extension-desktop.js` and confirm the new adapter/setup are missing.
- [ ] **Step 3:** Add bridge startup/shutdown and single-instance behavior, with `BLOGAUTO_USER_DATA` override for isolated Electron verification. Change only desktop publisher imports, pass account IDs at every desktop session/publish call, and stop treating legacy page/context caches as new connection evidence. Broadcast bridge status through the existing account-update channel.
- [ ] **Step 4:** Add installation path/copy guidance, per-account Chrome/code/cancel/revoke buttons and Tistory shared connection. Keep current UI labels and functions usable; guard repeated clicks and show errors near connection controls. New Chrome stays open when app ends. Generation-only mode does not require a publishing connection.
- [ ] **Step 5:** Run adapter/IPC tests and the existing Electron smoke inspection in an isolated runtime. Assert Himawari logo/title, product inputs, multiple photos, GPT-6.1 Sol and direct/auto topic controls. Commit.

### Task 4: 발행 증거와 플랫폼별 재개

**Files:** Create `src/lib/publishSequence.js`, `src/lib/publishRecovery.js`, `scripts/check-desktop-publishing.js`; modify `src/main.js`, `src/lib/desktopPublisher.js`, `src/renderer/app.js` and `scripts/check.js`.

**Interfaces:**
- `publishSequence(draft,{save,naver,tistory,log}): Promise<Draft>`; `save(state): Promise<void>` stores current `pendingNaverPublishDraft` plus job publication state.
- `confirmedPublication(result): boolean`; `recoverPendingPublication(draft,{bridge,save,log}): Promise<Draft>`.
- `draft.publications[platform]` has `status:'running'|'done'|'failed'|'uncertain'` plus completion proof. A result proves direct publication with the actual target post URL; reservation with `verification:'reservation-list'`, scheduled time and management URL; draft with title/time/list proof and clean editor return.
- `PUBLISH_UNCERTAIN` stops automatic retries and keeps the draft; `EXTENSION_DISCONNECTED`/login failures keep account state and Chrome.

- [ ] **Step 1:** Tests: Naver success followed by Tistory failure retries Tistory only; missing/wrong completion proof is uncertain; stop/restart after final click never enqueues the same article again; verified reservation recovery does not publish; pre-final interrupted writing may resume only when its durable journal proves no final attempt.
- [ ] **Step 2:** Run `node --test scripts/check-desktop-publishing.js`; observe missing modules.
- [ ] **Step 3:** Adapt upstream sequence/recovery to the existing draft schema without importing its generation pipeline/history dependencies. Save publication state before and after each platform. Connect both current pending-draft and freshly generated publishing paths to the same sequence. Keep current product policy checks.
- [ ] **Step 4:** Add an explicit Naver draft-save choice connected to the new engine and its completion evidence. For legacy pending drafts with no platform journal, preserve the article and require the user to check prior publication; never infer that a platform succeeded or is safe to repeat. Stop automatic loops on an uncertain outcome.
- [ ] **Step 5:** Run sequence/recovery and renderer status cases; integrate new checks into `npm run check` without dropping existing legacy/web/product checks. Commit.

### Task 5: 사용량 조회와 설정 저장 안정성

**Files:** Create `src/lib/atomicJson.js`, `scripts/check-local-state.js`; modify `src/lib/codexRunner.js`, `settings.js`, `accountStore.js`, `scripts/check.js`.

**Interfaces:**
- `writeJsonAtomic(file,value): void` writes same-directory temporary JSON, closes/flushed file, then renames it. Throws on failure and cleans only its own temporary file.
- Existing `writeSettings(root,patch)`, `writeAccountStore(root,store,settings)` signatures/schema remain.
- `fetchCodexUsageSnapshot(): Promise<Snapshot>` returns local session data or `source:'unavailable',rateLimits:null`; never launches an inference process for this display refresh.

- [ ] **Step 1:** Assert forced replacement failure leaves byte-identical valid previous settings and account JSON, including a pending article. Assert settings retain manual topic/generation-only/product/model values. Assert missing local usage records return unavailable with zero child-process spawns; existing session records still return limits.
- [ ] **Step 2:** Run `node --test scripts/check-local-state.js`; confirm failure against direct writes/exec fallback.
- [ ] **Step 3:** Implement the small atomic JSON helper using APIs supported by bundled Electron Node. Apply it to normal writes and legacy credential cleanup. Remove only usage-display inference fallback and retain saved/local limits handling and generation token accounting.
- [ ] **Step 4:** Run local-state tests and existing source/model/account regressions. Commit.

### Task 6: 호환성 검사·설치 안내·Windows 배포

**Files:** Modify `package.json`, `package-lock.json`, `README.md`, `EMPLOYEE_SETUP.md`, `scripts/prepare-dist-runtime.js`, `scripts/smoke-electron.js`; add `scripts/check-extension-package.js` as needed for packaged resources.

**Interfaces:** Windows portable `Himawari-Blog-Automator-Made-by-Hyunjin-0.2.0.exe`; bundled extension resources + attribution; existing `runtime` stays outside the executable.

- [ ] **Step 1:** Add resource checks for all manifest/script/icon files, version/build identity, unchanged app/logo assets, and absence of credentials/profiles/tokens in the template. Document the actual first-install and update sequence in Korean.
- [ ] **Step 2:** Run `npm run check` and isolated Electron smoke tests. Inspect the changed UI using the required UI/UX skill and current browser guide. Verify existing web publication imports are unchanged. Fix concrete failures and stop expanding tests after required risks are covered.
- [ ] **Step 3:** Obtain independent whole-branch code review, resolve Critical/Important findings, and rerun the affected tests plus final required checks.
- [ ] **Step 4:** Bump app to 0.2.0, run `npm run dist`, and verify packaged source and extension against the reviewed files. Confirm EXE/document hashes and preserved desktop runtime before replacing the local shortcut target.
- [ ] **Step 5:** Commit final files. Follow existing GitHub synchronization authorization to publish reviewed source and EXE/guide/SHA256 release assets; verify remote commit/tag and uploaded digests. Report tested scope, required extension setup and actual-account verification limitation.

## Plan Review State

- [x] Approved specification read and mapped to tasks.
- [x] Interfaces, task ordering and five Review Focus cases checked.
- [x] No new document/OCR dependencies or generation-pipeline replacement included.
- [ ] User reviews this implementation plan and selects execution method.
- [ ] Execute approved tasks and verification.

Recommendation: **Native** execution in this chat. Tasks depend on the existing main/renderer flow and the same adapter interfaces; one implementer can preserve that context, then a fresh reviewer checks the full branch before packaging.
