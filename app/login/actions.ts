"use server";

import { AuthError } from "next-auth";
import { signIn, signOut } from "@/auth";
import { normalizeUsername, safeNextPath } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getLockStatus } from "@/lib/users";

const lockedMessage = (minutes: number) =>
  `Too many failed attempts. This account is locked for ${minutes} more minute${minutes === 1 ? "" : "s"}.`;

export async function loginAction(_prev: { error?: string }, fd: FormData): Promise<{ error?: string }> {
  const username = normalizeUsername(String(fd.get("username") ?? ""));
  const password = String(fd.get("password") ?? "");
  const next = safeNextPath(String(fd.get("next") ?? "/"));
  if (!username || !password) return { error: "Enter your username and password." };

  const db = await getDb();
  const before = await getLockStatus(db, username);
  if (before.locked) return { error: lockedMessage(before.minutesLeft) };

  try {
    // On success this throws Next's redirect, which must not be caught.
    await signIn("credentials", { username, password, redirectTo: next });
    return {};
  } catch (err) {
    if (!(err instanceof AuthError)) throw err;
    const after = await getLockStatus(db, username);
    if (after.locked) return { error: lockedMessage(after.minutesLeft) };
    // Slow down guessing a little.
    await new Promise((r) => setTimeout(r, 600));
    return { error: "Wrong username or password." };
  }
}

export async function logoutAction() {
  await signOut({ redirectTo: "/login" });
}
