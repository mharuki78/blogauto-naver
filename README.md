# Himawari Blog Automator - Made by Hyunjin

## 웹앱 (Vercel)

배포 주소: https://blogauto-naver-himawari5.vercel.app (사용자 이름 `blogauto`, 배포 시 설정한 `APP_PASSWORD` 필요)

웹 화면은 `npm run dev:web`으로 로컬에서 열고, `npm run build:web`으로 빌드합니다. 배포된 Vercel 프로젝트에는 다음 환경 변수가 필요합니다.

- `APP_PASSWORD`: 웹 화면과 API에 적용되는 Basic 인증 암호 (사용자 이름: `blogauto`)
- `BLOB_READ_WRITE_TOKEN`: 작업 초안 및 이력을 보관할 **private** Vercel Blob 스토어 토큰
- `BROWSERBASE_API_KEY`, `BROWSERBASE_PROJECT_ID`: 네이버 로그인과 발행에 사용하는 클라우드 브라우저
- `AI_GATEWAY_API_KEY` 또는 Vercel 배포에서 자동 발급하는 OIDC: AI Gateway 글 생성

웹 흐름은 주제 입력 → AI Gateway 초안 생성 → 초안 검토·수정 → Browserbase Live View에서 네이버 직접 로그인 → 네이버 발행입니다. 로그인 정보는 앱에 입력하거나 저장하지 않습니다. Browserbase Context가 네이버 로그인 세션을 저장합니다. 자동 발행은 버튼을 누른 경우에만 시작됩니다.

현재 웹 버전은 **수동 주제 입력과 네이버 즉시 발행**을 지원합니다. 데스크톱 버전의 자동 주제 검색, 여러 에이전트 검토, 이미지 생성, 티스토리 발행, 예약·반복 발행, 다중 계정 관리는 아직 웹 버전에 포함되지 않았습니다. 참고 URL은 모델이 직접 읽지 않으므로 사실 확인은 발행 전에 사용자가 해야 합니다.

Browserbase 무료 요금제는 세션 시간과 월 브라우저 사용량에 제한이 있습니다. Vercel AI Gateway의 프로젝트 예산은 소프트 한도이므로, 실제 청구액을 강제로 $10 아래로 고정하는 장치는 아닙니다. 운영 시 Vercel과 Browserbase의 사용량을 함께 확인하세요.

> [!IMPORTANT]
> **Naver 로그인 방식이 자동 로그인에서 수동 로그인으로 변경되었습니다.**
>
> 계정에는 블로그 주소의 `Blog ID`만 등록합니다. 데스크톱 0.2.0은 일반 Chrome의 확장으로 글쓰기에 연결하며, 사용자가 Chrome에서 직접 로그인합니다. 네이버 계정마다 확장을 설치하고 연결 코드를 입력해야 합니다. 로그인 이후에는 해당 Chrome 프로필을 재사용합니다.

Codex 기반 Windows 데스크톱 자동화 콘솔입니다. Naver Blog 글 생성/발행을 기본 흐름으로 사용하고, Naver 발행이 성공하면 같은 제목, 본문, 이미지, 카테고리, 태그를 Tistory 블로그에도 이어서 발행할 수 있습니다.

상단 **Codex Model** 선택지는 이 PC의 Codex 모델 목록에서 읽습니다. 목록을 읽을 수 없으면 앱에 포함된 모델 목록을 사용합니다. 새 모델 목록이 반영되려면 앱을 다시 실행하세요.

## 주요 기능

- Naver 계정 여러 개와 계정별 카테고리 관리
- 카테고리별 키워드, 발행 목적, 검색 채널, 블로그 신뢰 설정 관리
- Research/Title Agent, Writer Agent, Main Review Agent, Image Worker 기반 글 생성
- 현재성/공식성/신뢰매체 근거 검증
- Naver 세션 확인, 수동 보안 확인 후 세션 재사용
- Tistory Kakao 로그인 세션 확인 및 재사용
- Naver 발행 성공 후 Tistory 동일 글 자동 발행
- Tistory-only 테스트 발행
- 공개, 비공개, 예약 발행 설정
- 제목 이미지와 본문 이미지 생성 및 업로드
- 태그 입력, 카테고리 매칭, 인용구 스타일 변환

## 기본 흐름

1. 계정 표시명과 Naver `Blog ID`, 카테고리, 키워드, 발행 목적을 설정합니다.
2. 확장 설치 폴더를 준비하고 계정별 Chrome에서 확장을 설치·연결합니다. Chrome에서 직접 로그인한 뒤 세션을 확인합니다. [설치 안내](EMPLOYEE_SETUP.md)에 순서가 있습니다.
3. Research/Title Agent가 주제와 제목 후보를 고르고 검색 근거를 수집합니다.
4. Writer Agent가 본문과 태그, 이미지 프롬프트를 작성합니다.
5. Main Review Agent가 제목 일치, 근거 신뢰도, 본문 품질, 독자 가치, 현재성 기준을 검토합니다.
6. Image Worker가 이미지를 생성합니다.
7. Naver Blog에 글을 작성하고 발행합니다.
8. Tistory 발행 옵션이 켜져 있고 세션이 유효하면 같은 글을 Tistory에도 발행합니다.

### 데스크톱 이미지 참조

계정을 선택한 뒤 **이미지 미리보기 → 참조 이미지 추가**에서 PNG, JPG, JPEG 또는 WebP 파일을 여러 개 고릅니다. 한 계정에 최대 10장(파일당 20MB)을 저장하며, 각 사진 아래의 삭제 버튼으로 개별 삭제하거나 전체 삭제할 수 있습니다. 기존에 등록한 한 장짜리 참조 이미지도 목록의 첫 사진으로 이어집니다. 저장된 이미지는 다음 생성 작업에서 Image Style Agent와 Image Worker에 모두 시각 입력으로 전달됩니다. 이미지 생성기는 원본의 구도·색감·질감과 관련된 피사체를 참고하며, 글의 내용과 각 섹션의 이미지 목적을 우선합니다. 여러 참조 입력을 사용할 수 없는 이미지 도구는 결과 메모에 그 이유를 남기도록 요청합니다.

네이버 편집기의 **AI 활용 표시**는 발행할 이미지의 표시 설정이며, 생성 단계의 참조 이미지와는 별개입니다. 데스크톱 확장은 실제 참조 원본 사진에 AI 생성 표시를 강제하지 않으며, 생성 이미지에는 표시를 적용하고 상태를 검증합니다. 필요한 입력이나 표시가 확인되지 않으면 최종 발행을 중지합니다.

### Chrome 연결과 발행 재개

**확장 설치 폴더 준비 → 계정별 Chrome 열기 → `chrome://extensions` 개발자 모드에서 설치 → 연결 코드 입력 → 직접 로그인 → 세션 확인** 순서로 설정합니다. 티스토리는 공용 일반 Chrome에서 별도로 연결합니다. 앱을 종료하거나 확인에 실패해도 Chrome은 열려 있습니다. 이미 열린 같은 블로그의 `?Redirect=Write` 편집기를 재사용합니다.

앱 0.2.0 / 확장 0.3.17 / 편집기 20261008.1 조합을 사용합니다. 확장 업데이트 후에는 같은 설치 폴더를 준비하고 각 Chrome 프로필에서 확장을 새로고침하세요. 0.1.x에서 옮길 때는 실행 파일 옆 `runtime`을 유지하되, 새 Chrome 확장 설치와 첫 로그인이 필요합니다. 이전 Playwright 로그인 쿠키는 복사하지 않습니다.

공개·비공개·예약 발행과 네이버 임시저장을 지원합니다. 임시저장과 티스토리 동시 발행은 함께 사용할 수 없습니다. 플랫폼별 완료 증거를 저장하여 네이버 성공 후 티스토리 실패 시 티스토리만 재개합니다. 최종 발행 뒤 연결이 끊겨 결과가 불확실하면 자동 재발행을 중지하고 원고를 유지합니다. 이전 보류 원고는 게시 목록을 직접 확인한 뒤 보관 처리합니다.

설정과 계정 JSON은 임시 파일 작성 후 교체하며, 교체 실패 시 이전 파일을 보존합니다. 사용량 배지는 로컬 Codex 기록만 읽고, 기록이 없으면 확인 불가를 표시합니다. 표시 갱신을 위한 모델 호출은 없습니다.

## 검색과 근거 기준

정책, 채용, 지원금, 신청, 모집, 법률, 가격, 일정처럼 독자 행동에 직접 영향을 주는 글은 공식 또는 기관 근거를 우선합니다.

AI 업계동향, 기술 발표, 모델 출시, 반도체 시장 변화 같은 글은 Naver Blog 후보만으로 확정하지 않습니다. 공식 출처가 없더라도 독립 편집 매체 또는 신뢰 가능한 웹 근거가 함께 확인되어야 합니다. 블로그 후보는 주제 발견 단서로 사용할 수 있지만, 블로그만으로 발표형 글을 발행하지 않습니다.

## 실행

```bash
npm install
npm start
```

검사:

```bash
npm run check
```

빌드:

```bash
npm run dist
```

직원 배포용 포터블 EXE와 [설치 안내](EMPLOYEE_SETUP.md)는 `dist/`에 생성됩니다. 각 직원 PC에 Codex CLI를 설치한 뒤 앱 상단의 **ChatGPT 연결**에서 계정 소유자가 직접 로그인합니다. EXE에는 로그인 정보가 포함되지 않습니다.

저장된 작업 실행:

```bash
npm run run:saved
```

최신 생성 결과 발행:

```bash
npm run publish:latest
```

## Tistory 테스트

앱 화면의 `Tistory 테스트 발행` 버튼을 사용하면 Naver 글 생성과 Naver 발행을 건너뛰고 Tistory 로그인, 본문 입력, 이미지 업로드, 카테고리 선택, 태그 입력, 최종 발행 흐름만 빠르게 테스트할 수 있습니다.

## 로컬 데이터와 계정정보

계정 설정, 세션, 브라우저 프로필, 작업 로그, 생성 이미지, 빌드 결과는 Git에 올리지 않습니다. Naver 비밀번호는 앱에 입력하거나 저장하지 않습니다. 대표 제외 대상은 다음과 같습니다.

- `runtime/`
- `dist/`
- `node_modules/`
- `**/user-settings.json`
- `**/account-categories.json`
- `**/account-assets/`
- `**/browser-profile/`
- `**/browser-profiles/`
- `.env`, `.env.*`, `*.local`
- `.codex/`, `.agents/`

## 주요 파일

- `src/main.js`: Electron main process, 작업 흐름, 세션 확인, Naver/Tistory 발행 오케스트레이션
- `src/lib/codexRunner.js`: Research/Title, Writer, Main Review, Image Worker 실행과 프롬프트 구성
- `src/lib/search.js`: 검색 후보 수집, 공식/기관/독립 신뢰 근거 판정, source quality 요약
- `src/lib/naverPublisher.js`: Naver 수동 로그인 대기, 글쓰기 편집기, 이미지/카테고리/태그/발행 자동화
- `src/lib/tistoryPublisher.js`: Tistory Kakao 세션, TinyMCE 본문 입력, 이미지/카테고리/태그/발행 자동화
- `src/lib/desktopPublisher.js`: 데스크톱의 계정별 Chrome 확장 세션·발행 어댑터
- `src/lib/extensionBridge.js`: localhost 연결 인증과 작업 기록
- `src/lib/publishSequence.js`, `publishRecovery.js`: 플랫폼별 완료 확인과 중복 방지
- `extension/`: 설치할 Chrome 확장 (가져온 소스의 출처: [UPSTREAM_NOTICES.md](UPSTREAM_NOTICES.md))
- `src/lib/accountStore.js`: 계정과 카테고리 저장 구조
- `src/lib/settings.js`: 앱 설정 기본값과 정규화
- `src/renderer/`: Electron renderer UI
- `scripts/check.js`: 프로젝트 구조와 핵심 회귀 조건 검사

전체 검사는 로컬 HTTP, 실제 Chrome의 모의 페이지와 기존 웹·상품·참조 사진 회귀를 포함합니다. `node scripts/smoke-electron.js`는 별도 runtime에서 화면을 검사합니다. Windows 빌드 후 `node scripts/check-extension-package.js --packaged`로 앱·확장 리소스의 일치와 사용자 데이터 제외를 확인합니다. 실제 계정에 게시하는 검사는 수행하지 않습니다.
