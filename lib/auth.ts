// Shared-password gate (stop-gap until real sign-in). The cookie holds an HMAC
// of the password, so changing APP_PASSWORD signs everyone out.

import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "fr_session";
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export function appPassword(): string | null {
  return process.env.APP_PASSWORD || null;
}

export function sessionToken(password: string): string {
  return createHmac("sha256", password).update("freshroots-session-v1").digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function isValidSession(cookieValue: string | undefined, password: string): boolean {
  return Boolean(cookieValue) && safeEqual(cookieValue!, sessionToken(password));
}

export function isCorrectPassword(input: string, password: string): boolean {
  // Compare fixed-length digests so the comparison time doesn't leak the length.
  return safeEqual(sessionToken(input), sessionToken(password));
}

/** Only allow same-site relative paths as the post-login destination. */
export function safeNextPath(next: string | null | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}
