import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, appPassword, isValidSession } from "@/lib/auth";

/** Every page, server action and the CSV export need the shared password. */
export function proxy(request: NextRequest) {
  const password = appPassword();
  // No password configured (e.g. local dev): the site stays open.
  if (!password) return NextResponse.next();
  if (isValidSession(request.cookies.get(SESSION_COOKIE)?.value, password)) return NextResponse.next();

  if (request.method === "GET" || request.method === "HEAD") {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(login);
  }
  return new NextResponse("Sign in required", { status: 401 });
}

export const config = {
  // Everything except the login page, Next.js assets and the favicon.
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico).*)"],
};
