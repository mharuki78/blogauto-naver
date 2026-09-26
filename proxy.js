import { NextResponse } from "next/server";

export function proxy(request) {
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

