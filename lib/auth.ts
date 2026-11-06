// Passwords, login lockout and redirect safety. Pure (no database), so it's unit-tested.

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// ---------- Passwords (scrypt, Node built-in) ----------

const SCRYPT = { N: 16384, r: 8, p: 1, keyLen: 32 };
export const MIN_PASSWORD_LENGTH = 10;

/** "scrypt$N$r$p$salt$hash" (base64). The plain password is never stored. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT.keyLen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64"), hash.toString("base64")].join("$");
}

export function verifyPassword(password: string, stored: string): boolean {
  const [kind, n, r, p, salt, hash] = stored.split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = scryptSync(password, Buffer.from(salt, "base64"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Returns an error message, or null if the password is acceptable. */
export function checkNewPassword(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (/^\s|\s$/.test(password)) return "The password can't start or end with a space.";
  return null;
}

export const normalizeUsername = (u: string) => u.trim().toLowerCase();

export function checkUsername(username: string): string | null {
  return /^[a-z0-9._-]{3,32}$/.test(username)
    ? null
    : "Usernames are 3-32 characters: letters, numbers, dot, dash or underscore.";
}

// ---------- Lockout: 5 failed attempts in a row lock the username for 15 minutes ----------

export const LOCKOUT = { maxFailures: 5, minutes: 15 };

export interface AttemptState {
  failedCount: number;
  lockedUntil: Date | null;
}

export function lockStatus(state: AttemptState | null | undefined, now: Date) {
  if (!state?.lockedUntil || state.lockedUntil <= now) return { locked: false as const, minutesLeft: 0 };
  return { locked: true as const, minutesLeft: Math.ceil((state.lockedUntil.getTime() - now.getTime()) / 60_000) };
}

/** State after one more failed attempt. A lock that has expired starts a fresh count. */
export function afterFailedAttempt(state: AttemptState | null | undefined, now: Date): AttemptState {
  const expired = state?.lockedUntil != null && state.lockedUntil <= now;
  const failedCount = (expired ? 0 : (state?.failedCount ?? 0)) + 1;
  const lockedUntil =
    failedCount >= LOCKOUT.maxFailures
      ? new Date(now.getTime() + LOCKOUT.minutes * 60_000)
      : expired
        ? null
        : (state?.lockedUntil ?? null);
  return { failedCount, lockedUntil };
}

// ---------- Redirect safety ----------

/** Only same-site paths, so the login page can't be used to bounce people to another site. */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  return next;
}
