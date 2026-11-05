import Link from "next/link";
import { FlagBadge, StatusBadge, actionText } from "@/components/badges";
import { GenerateExplanationsForm, RecalculateForm } from "@/components/forms";
import { geminiConfigured } from "@/lib/ai/gemini";
import { getDb } from "@/lib/db";
import { fmt1, fmtDateTime, fmtInt } from "@/lib/format";
import { getLatestRun, getRunRecommendations } from "@/lib/run-engine";
import { FLAG_LABELS, type Flag } from "@/lib/rules/engine";

export const dynamic = "force-dynamic";

const FLAG_ORDER: Flag[] = ["EXCEPTION", "STOCKOUT", "OVERSTOCK", "HIGH_DEMAND", "NO_ACTION"];

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ flag?: string }> }) {
  const { flag } = await searchParams;
  const db = await getDb();
  const run = await getLatestRun(db);

  if (!run) {
    return (
      <>
        <h1>Dashboard</h1>
        <div className="card stack">
          <p>No recommendations yet. Load data on the <Link href="/upload">Upload</Link> page (or run <code>npm run db:seed</code>), then recalculate.</p>
          <RecalculateForm />
        </div>
      </>
    );
  }

  const rows = await getRunRecommendations(db, run.id);
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.rec.flag, (counts.get(r.rec.flag) ?? 0) + 1);
  const shown = flag ? rows.filter((r) => r.rec.flag === flag) : rows;
  const pending = rows.filter((r) => r.rec.status === "PENDING").length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <div className="muted">
            Run #{run.id} · sales up to week {run.nowWeek} · {fmtDateTime(run.createdAt)} by {run.triggeredBy} ·{" "}
            <Link href="/review">{pending} awaiting review</Link>
          </div>
        </div>
        <div className="stack">
          <RecalculateForm />
          <GenerateExplanationsForm enabled={geminiConfigured()} />
        </div>
      </div>

      <div className="filters" aria-label="Filter by flag">
        <Link href="/" className={`chip ${!flag ? "active" : ""}`}>
          All ({rows.length})
        </Link>
        {FLAG_ORDER.filter((f) => counts.has(f)).map((f) => (
          <Link key={f} href={`/?flag=${f}`} className={`chip ${flag === f ? "active" : ""}`}>
            {FLAG_LABELS[f]} ({counts.get(f)})
          </Link>
        ))}
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Name</th>
              <th>Perishability</th>
              <th className="num">Stock</th>
              <th className="num">Avg weekly demand</th>
              <th className="num">Weeks of cover</th>
              <th>Flag</th>
              <th>Recommended action</th>
              <th>Reason</th>
              <th>Review</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(({ rec, sku, ai, evaluation: e }) => (
              <tr key={rec.id}>
                <td>
                  <Link href={`/sku/${rec.skuId}`}>{rec.skuId}</Link>
                </td>
                <td>{sku?.name ?? <span className="muted">not in SKU master</span>}</td>
                <td>{e.perishability ?? "—"}</td>
                <td className="num">{fmtInt(e.unitsOnHand)}</td>
                <td className="num" title="Average of the last 12 weeks">
                  {fmt1(e.avg12)}
                  {e.festivalMonth && e.demandBaseline != null && (
                    <div className="muted" title="Festival-month baseline used for cover">
                      festival {fmt1(e.demandBaseline)}
                    </div>
                  )}
                </td>
                <td className="num">{fmt1(e.weeksOfCover)}</td>
                <td>
                  <FlagBadge flag={rec.flag} />
                </td>
                <td>{actionText(rec.action, rec.quantity)}</td>
                <td className="reason">
                  {ai?.reason ?? rec.reason}
                  {ai?.reason && <span className="muted"> (AI)</span>}
                </td>
                <td>
                  <StatusBadge status={rec.status} />
                  {rec.finalQuantity != null && rec.finalQuantity !== rec.quantity && (
                    <div className="muted">final {fmtInt(rec.finalQuantity)}</div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted">
        Avg weekly demand is the 12-week average. In festival months, weeks of cover uses the uplifted baseline shown
        underneath.
      </p>
    </>
  );
}
