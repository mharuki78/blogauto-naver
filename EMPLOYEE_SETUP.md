# Bolg Automator 직원용 실행 안내

## 설치와 실행

1. `Bolg-Automator-Made-by-Hyunjin-0.1.0.exe`를 직원 PC의 쓰기 가능한 폴더에 저장하고 실행합니다. Windows x64용 포터블 실행 파일이며 설치 프로그램은 아닙니다.
2. Google Chrome을 설치합니다. Naver와 Tistory 로그인 및 발행에 사용합니다.
3. Codex CLI를 설치합니다. Node.js가 설치된 PC라면 PowerShell에서 `npm install -g @openai/codex`를 실행할 수 있습니다. [공식 Codex CLI 안내](https://learn.chatgpt.com/docs/codex/cli)를 참고하세요.
4. PowerShell에서 `codex login`을 실행하고 승인된 ChatGPT 계정으로 로그인합니다. `codex login status`가 로그인 상태를 표시하는지 확인한 뒤 앱을 실행합니다.
5. 앱에서 Naver 블로그 계정을 등록하고, 세션 확인 또는 발행 시 열린 Chrome 창에서 Naver에 직접 로그인합니다.

실행 파일에는 ChatGPT 로그인 정보, API 키, Naver 비밀번호, 기존 브라우저 세션이 들어 있지 않습니다. Codex는 **직원 PC의 Windows 사용자별 로그인 상태**를 사용합니다. 앱은 실행 파일 옆의 `runtime` 폴더에 계정 설정, 작업 기록, 이미지와 브라우저 세션을 저장합니다. 이 폴더는 직원별로 분리하고 타인에게 전달하지 마세요.

## 회사 계정으로 AI 사용하기

개인 ChatGPT 계정으로 직원 PC에서 직접 로그인하면 해당 PC 사용자에게 그 계정의 Codex 사용 권한이 남습니다. 실행 파일에 아이디·비밀번호나 Codex 인증 파일을 넣어 배포하지 마세요. 회사 단위 사용은 직원별 계정을 회사 ChatGPT 워크스페이스에 초대하거나, 관리형 서비스 계정·액세스 토큰을 신뢰할 수 있는 환경에서 사용하는 방식이 적합합니다. [OpenAI의 Codex 인증 안내](https://learn.chatgpt.com/docs/auth)와 [워크스페이스 액세스 토큰 안내](https://learn.chatgpt.com/docs/enterprise/access-tokens)를 참고하세요. 워크스페이스 토큰은 요금제와 관리자 설정에 따라 사용 가능 여부가 다릅니다.

## 배포 시 확인

- 직원에게는 `.exe`와 이 안내 파일을 전달합니다. 개발용 `runtime` 폴더, `.codex` 폴더, `auth.json`, API 키는 전달하지 않습니다.
- 처음 실행할 때 발행 옵션을 켜기 전에 글 생성과 이미지 미리보기를 시험합니다.
- 이 실행 파일은 코드 서명 인증서로 서명되지 않았습니다. Windows에서 게시자 확인 경고가 나올 수 있으므로 파일 출처와 해시를 확인한 뒤 배포하세요.
