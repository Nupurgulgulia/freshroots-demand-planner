import { desc } from "drizzle-orm";
import { AddFestivalMonthForm, FestivalToggle, RunJobNowForm, ThresholdsForm } from "@/components/forms";
import { getRecentEmails, getRecentJobs } from "@/lib/automation/job";
import { freshnessLimits } from "@/lib/automation/schedule";
import { getDb, schema } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";
import { THRESHOLD_DEFS, formatThreshold, getThresholds, toDisplay } from "@/lib/settings";
import { getSettingsLog } from "@/lib/settings-update";
import { requirePage } from "@/lib/session";

export const dynamic = "force-dynamic";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default async function SettingsPage() {
  await requirePage("editSettings");
  const db = await getDb();
  const [jobs, emails] = await Promise.all([getRecentJobs(db), getRecentEmails(db)]);
  const limits = freshnessLimits();
  const emailOn = Boolean(process.env.RESEND_API_KEY);
  const cronOn = Boolean(process.env.CRON_SECRET);
  const [thresholds, calendar, log] = await Promise.all([
    getThresholds(db),
    db.select().from(schema.festivalCalendar).orderBy(desc(schema.festivalCalendar.yearMonth)),
    getSettingsLog(db),
  ]);
  const defsByKey = new Map(THRESHOLD_DEFS.map((d) => [d.key as string, d]));

  const describeChange = (area: string, key: string, value: string | null) => {
    if (value == null) return "—";
    if (area === "calendar") return value === "true" ? "Festival" : "Not festival";
    const def = defsByKey.get(key);
    return def ? formatThreshold(def, Number(value)) : value;
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="muted">
            Changes apply the next time you press Recalculate on the dashboard. Existing runs keep the thresholds they
            were calculated with.
          </p>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h2>Thresholds</h2>
          <ThresholdsForm
            defs={THRESHOLD_DEFS.map((d) => ({
              key: d.key,
              label: d.label,
              unit: d.unit,
              display: toDisplay(d, thresholds[d.key]),
            }))}
          />
        </div>

        <div className="card stack">
          <h2>Festival calendar</h2>
          <AddFestivalMonthForm />
          <div className="table-wrap">
            <table className="table stack-table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Festival?</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {calendar.map((c) => (
                  <tr key={c.yearMonth}>
                    <td data-label="Month">
                      {MONTHS[c.month - 1]} {c.year}
                    </td>
                    <td data-label="Festival?">{c.isFestivalMonth ? <span className="badge flag-OVERSTOCK">Festival</span> : "—"}</td>
                    <td>
                      <FestivalToggle yearMonth={c.yearMonth} isFestival={c.isFestivalMonth} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">Every change is logged against your account.</p>
        </div>
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <div className="card-head">
          <div>
            <h2>Automation</h2>
            <div className="muted small">
              Runs every day at about 06:00 India time and recalculates on Mondays and Thursdays: syncs open POs from
              Zoho (if connected), skips if sales lag more than {limits.salesWeeksBehind} week(s) or stock is over{" "}
              {limits.stockDays} days old, recalculates, writes AI text within the monthly limit, and emails planners.
              Reviews pending over 2 days get a daily reminder.
            </div>
          </div>
          <span className="row">
            <span className={`badge no-dot ${cronOn ? "tone-ok" : "tone-overstock"}`}>
              {cronOn ? "Schedule on" : "Schedule off (no CRON_SECRET)"}
            </span>
            <span className={`badge no-dot ${emailOn ? "tone-ok" : "tone-neutral"}`}>
              {emailOn ? "Email via Resend" : "Email logged only"}
            </span>
          </span>
        </div>
        <RunJobNowForm />
        <div className="grid-2" style={{ marginTop: 16 }}>
          <div>
            <h3>Recent jobs</h3>
            {jobs.length === 0 ? (
              <p className="muted small">None yet.</p>
            ) : (
              <ul className="zoho-list">
                {jobs.map((j) => (
                  <li key={j.id}>
                    <div>
                      <strong>#{j.id}</strong> <span className="product-meta">{fmtDateTime(j.startedAt)} · {j.trigger === "cron" ? "scheduled" : `run now by ${j.triggeredBy}`}</span>
                      <div className="small">
                        <span className={`badge no-dot ${j.outcome === "ran" ? "tone-ok" : j.outcome === "failed" ? "tone-stockout" : "tone-neutral"}`}>
                          {(j.outcome ?? "running").replace(/_/g, " ")}
                        </span>{" "}
                        {j.message}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3>Recent emails</h3>
            {emails.length === 0 ? (
              <p className="muted small">None yet.</p>
            ) : (
              <ul className="zoho-list">
                {emails.map((e) => (
                  <li key={e.id}>
                    <div>
                      <strong>{e.subject}</strong>
                      <div className="product-meta">
                        {fmtDateTime(e.createdAt)} · to {e.recipients || "nobody (no matching users)"}
                      </div>
                      <div className="small">
                        <span className={`badge no-dot ${e.status === "sent" ? "tone-ok" : e.status === "failed" ? "tone-stockout" : "tone-neutral"}`}>
                          {e.status === "logged" ? "logged (no RESEND_API_KEY)" : e.status.replace(/_/g, " ")}
                        </span>
                        {e.error ? ` ${e.error}` : ""}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <h2>Change log</h2>
        {log.length === 0 ? (
          <p className="muted">No changes yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="table stack-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>Setting</th>
                  <th>From</th>
                  <th>To</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {log.map((l) => (
                  <tr key={l.id}>
                    <td data-label="When">{fmtDateTime(l.changedAt)}</td>
                    <td data-label="Who">{l.changedBy}</td>
                    <td data-label="Setting">{l.area === "calendar" ? `Calendar ${l.key}` : (defsByKey.get(l.key)?.label ?? l.key)}</td>
                    <td data-label="From">{describeChange(l.area, l.key, l.oldValue)}</td>
                    <td data-label="To">{describeChange(l.area, l.key, l.newValue)}</td>
                    <td data-label="Note">{l.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
