// Called by Vercel Cron once a day (see vercel.json). Vercel sends "Authorization: Bearer <CRON_SECRET>";
// anything else gets 401, and with no CRON_SECRET set the job can't be triggered at all.
import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/lib/db";
import { runScheduledJob } from "@/lib/automation/job";

export const dynamic = "force-dynamic";
// Recalculating and asking Gemini for a run's explanations can take a while.
export const maxDuration = 300;

function authorized(header: string | null) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  if (!authorized(request.headers.get("authorization"))) {
    return new Response("Unauthorized", { status: 401 });
  }
  const result = await runScheduledJob(await getDb(), { trigger: "cron" });
  return Response.json(result, { status: result.outcome === "failed" ? 500 : 200 });
}
