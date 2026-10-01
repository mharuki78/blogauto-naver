# Himawari Blog Automator 직원용 실행 안내

## 설치와 실행

1. `Himawari-Blog-Automator-Made-by-Hyunjin-0.1.2.exe`를 직원 PC의 쓰기 가능한 폴더에 저장하고 실행합니다. Windows x64용 포터블 실행 파일이며 설치 프로그램은 아닙니다.
2. Google Chrome을 설치합니다. Naver와 Tistory 로그인 및 발행에 사용합니다.
3. Codex CLI를 설치합니다. Node.js가 설치된 PC라면 PowerShell에서 `npm install -g @openai/codex`를 실행할 수 있습니다. [공식 Codex CLI 안내](https://learn.chatgpt.com/docs/codex/cli)를 참고하세요.
4. 앱 상단의 **ChatGPT 연결**을 누릅니다. 계정 소유자가 직원 PC에서 직접 자신의 ChatGPT 계정으로 로그인합니다. 앱에 **ChatGPT 연결됨**이 표시되는지 확인합니다. 필요하면 PowerShell에서 `codex login status`로도 확인할 수 있습니다.
5. 앱에서 Naver 블로그 계정을 등록하고, 세션 확인 또는 발행 시 열린 Chrome 창에서 Naver에 직접 로그인합니다.

Codex Model에서 `GPT-6.1 Sol`을 선택할 수 있습니다. 선택 후 실행이 모델 지원 오류로 멈추면 직원 PC의 Codex CLI를 업데이트해 주세요.

실행 파일에는 ChatGPT 로그인 정보, API 키, Naver 비밀번호, 기존 브라우저 세션이 들어 있지 않습니다. Codex는 **직원 PC의 Windows 사용자별 로그인 상태**를 사용합니다. 앱은 실행 파일 옆의 `runtime` 폴더에 계정 설정, 작업 기록, 이미지와 브라우저 세션을 저장합니다. 이 폴더는 직원별로 분리하고 타인에게 전달하지 마세요.

## 회사 계정으로 AI 사용하기

개인 ChatGPT 계정으로 직원 PC에서 직접 로그인하면 해당 PC 사용자에게 그 계정의 Codex 사용 권한이 남습니다. 앱의 상태 표시는 인증 **방식**을 확인하며 계정 이메일까지 검증하지는 않습니다. 로그인할 때 브라우저에서 올바른 계정을 선택하세요. 실행 파일에 아이디·비밀번호나 Codex 인증 파일을 넣어 배포하지 마세요. [OpenAI의 Codex 인증 안내](https://learn.chatgpt.com/docs/auth)를 참고하세요.

## 배포 시 확인

- 직원에게는 `.exe`와 이 안내 파일을 전달합니다. 개발용 `runtime` 폴더, `.codex` 폴더, `auth.json`, API 키는 전달하지 않습니다.
- 처음 실행할 때 발행 옵션을 켜기 전에 글 생성과 이미지 미리보기를 시험합니다.
- 이 실행 파일은 코드 서명 인증서로 서명되지 않았습니다. Windows에서 게시자 확인 경고가 나올 수 있으므로 파일 출처와 `SHA256SUMS.txt`의 해시를 확인한 뒤 배포하세요.

## 네이버 로그인 문제 확인

세션 확인 중 오류가 나면 앱의 실행 기록에 이유를 표시하고 크롬 창을 유지합니다. 크롬 화면의 안내와 앱 실행 기록을 캡처해 전달해 주세요. `runtime/browser-profiles`에는 로그인 상태가 저장되므로 이 폴더나 비밀번호는 전달하지 마세요.
