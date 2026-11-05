"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  appPassword,
  isCorrectPassword,
  safeNextPath,
  sessionToken,
} from "@/lib/auth";

export async function loginAction(_prev: { error?: string }, fd: FormData): Promise<{ error?: string }> {
  const password = appPassword();
  const next = safeNextPath(String(fd.get("next") ?? "/"));
  if (!password) redirect(next);

  if (!isCorrectPassword(String(fd.get("password") ?? ""), password)) {
    // Slow down guessing.
    await new Promise((r) => setTimeout(r, 800));
    return { error: "Wrong password." };
  }
  (await cookies()).set(SESSION_COOKIE, sessionToken(password), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  redirect(next);
}

export async function logoutAction() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
