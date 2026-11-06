// Users and login attempts in the database.

import { eq, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { schema } from "@/lib/db";
import {
  afterFailedAttempt,
  checkNewPassword,
  checkUsername,
  hashPassword,
  lockStatus,
  normalizeUsername,
  verifyPassword,
} from "@/lib/auth";
import { isRole, type Role } from "@/lib/permissions";

export interface SessionUser {
  id: number;
  username: string;
  email: string;
  role: Role;
}

export async function findUserByUsername(db: Db, username: string) {
  const [u] = await db.select().from(schema.users).where(eq(schema.users.username, normalizeUsername(username)));
  return u ?? null;
}

export async function findActiveUserById(db: Db, id: number): Promise<SessionUser | null> {
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, id));
  if (!u || !u.active || !isRole(u.role)) return null;
  return { id: u.id, username: u.username, email: u.email, role: u.role };
}

export async function getLockStatus(db: Db, username: string, now = new Date()) {
  const [row] = await db
    .select()
    .from(schema.loginAttempts)
    .where(eq(schema.loginAttempts.username, normalizeUsername(username)));
  return lockStatus(row, now);
}

/**
 * Checks a username and password, applying the lockout. Every failure (including unknown names and
 * attempts while locked) is counted; a success clears the count.
 */
export async function attemptLogin(db: Db, rawUsername: string, password: string, now = new Date()) {
  const username = normalizeUsername(rawUsername);
  const [attempts] = await db.select().from(schema.loginAttempts).where(eq(schema.loginAttempts.username, username));
  if (lockStatus(attempts, now).locked) return { ok: false as const, reason: "locked" as const };

  const user = await findUserByUsername(db, username);
  const valid = user != null && user.active && isRole(user.role) && verifyPassword(password, user.passwordHash);
  if (!valid) {
    const next = afterFailedAttempt(attempts, now);
    await db
      .insert(schema.loginAttempts)
      .values({ username, ...next, lastFailedAt: now })
      .onConflictDoUpdate({
        target: schema.loginAttempts.username,
        set: { failedCount: next.failedCount, lockedUntil: next.lockedUntil, lastFailedAt: now },
      });
    return { ok: false as const, reason: lockStatus(next, now).locked ? ("locked" as const) : ("invalid" as const) };
  }

  await db.delete(schema.loginAttempts).where(eq(schema.loginAttempts.username, username));
  await db.update(schema.users).set({ lastLoginAt: now }).where(eq(schema.users.id, user.id));
  return {
    ok: true as const,
    user: { id: user.id, username: user.username, email: user.email, role: user.role as Role } satisfies SessionUser,
  };
}

/** Creates a user, or with `reset` replaces the password (and email/role) of an existing one. */
export async function upsertUser(
  db: Db,
  input: { username: string; email: string; role: string; password: string; reset?: boolean },
) {
  const username = normalizeUsername(input.username);
  const problem =
    checkUsername(username) ??
    (isRole(input.role) ? null : "Role must be planner, procurement or viewer.") ??
    (/^\S+@\S+\.\S+$/.test(input.email.trim()) ? null : "Enter a valid email address.") ??
    checkNewPassword(input.password);
  if (problem) return { ok: false as const, error: problem };

  const existing = await findUserByUsername(db, username);
  if (existing && !input.reset) {
    return { ok: false as const, error: `User "${username}" already exists. Add --reset to change their password.` };
  }
  const values = { email: input.email.trim(), role: input.role, passwordHash: hashPassword(input.password), active: true };
  if (existing) {
    await db.update(schema.users).set(values).where(eq(schema.users.id, existing.id));
    await db.delete(schema.loginAttempts).where(eq(schema.loginAttempts.username, username));
    return { ok: true as const, created: false };
  }
  await db.insert(schema.users).values({ username, ...values });
  return { ok: true as const, created: true };
}

export async function setUserActive(db: Db, username: string, active: boolean) {
  const result = await db
    .update(schema.users)
    .set({ active })
    .where(eq(schema.users.username, normalizeUsername(username)))
    .returning({ id: schema.users.id });
  return result.length > 0;
}

/** Diagnostics for `npm run invite -- --check`: never counts as a login attempt. */
export async function checkCredentials(db: Db, username: string, password: string, now = new Date()) {
  const user = await findUserByUsername(db, username);
  const lock = await getLockStatus(db, username, now);
  if (!user) return { exists: false as const, lock };
  return {
    exists: true as const,
    active: user.active,
    role: user.role,
    passwordMatches: password ? verifyPassword(password, user.passwordHash) : null,
    lock,
  };
}

/** Changes only the role; the password, email and lockout state are left alone. */
export async function setUserRole(db: Db, username: string, role: string) {
  if (!isRole(role)) return { ok: false as const, error: "Role must be planner, procurement or viewer." };
  const [existing] = await db
    .select({ id: schema.users.id, role: schema.users.role })
    .from(schema.users)
    .where(eq(schema.users.username, normalizeUsername(username)));
  if (!existing) return { ok: false as const, error: `No user "${normalizeUsername(username)}".` };
  await db.update(schema.users).set({ role }).where(eq(schema.users.id, existing.id));
  return { ok: true as const, previousRole: existing.role };
}

export async function changePassword(db: Db, userId: number, current: string, next: string) {
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!u || !verifyPassword(current, u.passwordHash)) return { ok: false as const, error: "Your current password is wrong." };
  const problem = checkNewPassword(next);
  if (problem) return { ok: false as const, error: problem };
  if (current === next) return { ok: false as const, error: "Choose a password different from the current one." };
  await db.update(schema.users).set({ passwordHash: hashPassword(next) }).where(eq(schema.users.id, userId));
  return { ok: true as const };
}

export async function countUsers(db: Db) {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.users);
  return row?.n ?? 0;
}
