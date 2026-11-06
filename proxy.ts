import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";
import { canOpen, isRole } from "@/lib/permissions";

const { auth } = NextAuth(authConfig);

/**
 * Sends signed-out visitors to /login and keeps each role on the pages it may open. This is the first
 * line only: every page and server action checks the user again against the database (lib/session.ts).
 */
export const proxy = auth((request) => {
  const { pathname, search } = request.nextUrl;
  const role = (request.auth?.user as { role?: unknown } | undefined)?.role;
  const isPageLoad = request.method === "GET" || request.method === "HEAD";

  if (!request.auth || !isRole(role)) {
    if (!isPageLoad) return new NextResponse("Sign in required", { status: 401 });
    const login = new URL("/login", request.url);
    login.searchParams.set("next", pathname + search);
    return NextResponse.redirect(login);
  }
  if (!canOpen(role, pathname)) {
    if (!isPageLoad) return new NextResponse("Not allowed for your role", { status: 403 });
    return NextResponse.redirect(new URL("/?denied=1", request.url));
  }
  return NextResponse.next();
});

export const config = {
  // Everything except the login page, Auth.js's own routes, the cron job (it checks CRON_SECRET itself),
  // Next.js internals (assets, and the dev
  // server's live-update socket, which breaks into a reload loop if it passes through the sign-in
  // check) and the favicon.
  matcher: ["/((?!login|api/auth|api/cron|_next/|favicon.ico).*)"],
};
