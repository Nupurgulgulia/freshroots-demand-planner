// Email through Resend (https://resend.com). Without RESEND_API_KEY nothing is sent: the message is
// logged (console + email_log table) so you can see what would have gone out.

import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { schema } from "@/lib/db";
import type { Role } from "@/lib/permissions";

export type EmailKind = "run_summary" | "stale_data" | "review_reminder";

export interface Email {
  kind: EmailKind;
  to: string[];
  subject: string;
  text: string;
}

export type SendEmail = (email: Email) => Promise<{ status: "sent" | "logged" | "failed"; error?: string }>;

/** Default sender; with no verified domain, Resend only delivers onboarding@resend.dev mail to the account owner. */
const fromAddress = () => process.env.EMAIL_FROM || "Freshroots Planner <onboarding@resend.dev>";

export const resendSender: SendEmail = async (email) => {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log(`[email not sent: no RESEND_API_KEY] to=${email.to.join(", ")} subject="${email.subject}"`);
    return { status: "logged" };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: fromAddress(), to: email.to, subject: email.subject, text: email.text }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      return { status: "failed", error: `Resend refused: ${body.message ?? `HTTP ${res.status}`}` };
    }
    return { status: "sent" };
  } catch (err) {
    return { status: "failed", error: `Couldn't reach Resend: ${(err as Error).message}` };
  }
};

/** Active users' email addresses for the given roles. */
export async function recipientsFor(db: Db, roles: Role[]) {
  const rows = await db
    .select({ email: schema.users.email })
    .from(schema.users)
    .where(and(eq(schema.users.active, true), inArray(schema.users.role, roles)));
  return [...new Set(rows.map((r) => r.email.trim()).filter((e) => /^\S+@\S+\.\S+$/.test(e)))];
}

/** Sends (or logs) one email and records it in email_log. */
export async function deliver(db: Db, email: Email, jobId: number | null, send: SendEmail = resendSender) {
  if (email.to.length === 0) {
    await db.insert(schema.emailLog).values({
      kind: email.kind,
      recipients: "",
      subject: email.subject,
      body: email.text,
      status: "no_recipients",
      jobId,
    });
    return { status: "no_recipients" as const };
  }
  const result = await send(email);
  await db.insert(schema.emailLog).values({
    kind: email.kind,
    recipients: email.to.join(", "),
    subject: email.subject,
    body: email.text,
    status: result.status,
    error: result.error ?? null,
    jobId,
  });
  return result;
}

/** Link back to the app in emails. */
export function appUrl() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return "http://localhost:3000";
}
