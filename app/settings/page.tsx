import { desc } from "drizzle-orm";
import { AddFestivalMonthForm, FestivalToggle, ThresholdsForm } from "@/components/forms";
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
