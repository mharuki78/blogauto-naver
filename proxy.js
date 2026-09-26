import { NextResponse } from "next/server";

export function proxy(request) {
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const origin = request.headers.get("origin");
    if (origin && origin !== request.nextUrl.origin) {
      return new NextResponse("허용되지 않은 요청 출처입니다.", { status: 403 });
    }
    if (request.headers.get("sec-fetch-site") === "cross-site") {
      return new NextResponse("허용되지 않은 외부 요청입니다.", { status: 403 });
    }
  }
  const password = process.env.APP_PASSWORD;
  if (!password) {
    return new NextResponse("APP_PASSWORD 환경 변수를 설정해 주세요.", { status: 503 });
  }
  const header = request.headers.get("authorization") || "";
  let accepted = false;
  if (header.startsWith("Basic ")) {
    try {
      const [user, pass] = atob(header.slice(6)).split(":");
      accepted = user === "blogauto" && pass === password;
    } catch {}
  }
  if (!accepted) {
    return new NextResponse("로그인이 필요합니다.", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="Blogauto"', "Cache-Control": "no-store" },
    });
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };

