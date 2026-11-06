// The signed-in user for pages and server actions, re-checked against the database every time,
// so disabling a user or changing their role takes effect immediately.

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getDb } from "@/lib/db";
import { can, type Permission } from "@/lib/permissions";
import { findActiveUserById, type SessionUser } from "@/lib/users";

export async function currentUser(): Promise<SessionUser | null> {
  const session = await auth();
  const id = Number((session?.user as { id?: string } | undefined)?.id);
  if (!Number.isInteger(id) || id <= 0) return null;
  return findActiveUserById(await getDb(), id);
}

/** For pages: the user, or a redirect to sign-in / the dashboard. */
export async function requirePage(permission?: Permission): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (permission && !can(user.role, permission)) redirect("/?denied=1");
  return user;
}

/** For server actions: the user, or an error message to show instead of doing anything. */
export async function requireAction(
  permission: Permission,
): Promise<{ user: SessionUser; error: "" } | { user: null; error: string }> {
  const user = await currentUser();
  if (!user) return { user: null, error: "Your session has ended. Sign in again." };
  if (!can(user.role, permission)) return { user: null, error: "Your role doesn't allow this." };
  return { user, error: "" };
}
