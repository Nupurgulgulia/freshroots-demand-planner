import { ACTION_LABELS, FLAG_LABELS, type Action, type Flag } from "@/lib/rules/engine";
import { fmt1 } from "@/lib/format";

export function FlagBadge({ flag }: { flag: string }) {
  return <span className={`badge flag-${flag}`}>{FLAG_LABELS[flag as Flag] ?? flag}</span>;
}

const STATUS_LABELS: Record<string, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  EDITED: "Approved (edited)",
  REJECTED: "Rejected",
  NO_ACTION: "—",
};

export function StatusBadge({ status }: { status: string }) {
  if (status === "NO_ACTION") return <span className="muted">—</span>;
  return <span className={`badge no-dot status-${status}`}>{STATUS_LABELS[status] ?? status}</span>;
}

export function actionText(action: string, quantity: number | null) {
  const label = ACTION_LABELS[action as Action] ?? action;
  return action === "REORDER" && quantity != null ? `${label}: ${quantity.toLocaleString("en-IN")}` : label;
}

/** Short form for tables: "Order 750", "Pause next order", "—". */
export function ActionText({ action, quantity }: { action: string; quantity: number | null }) {
  if (action === "NONE") return <span className="action-text quiet">No action</span>;
  if (action === "REORDER" && quantity != null)
    return <span className="action-text">Order {quantity.toLocaleString("en-IN")}</span>;
  return <span className="action-text">{ACTION_LABELS[action as Action] ?? action}</span>;
}

/**
 * Weeks of cover as a bar. The scale runs to 1.25× the SKU's own overstock threshold, so the
 * colour and length show where the SKU sits between its stockout and overstock limits.
 */
export function CoverBar({
  weeks,
  stockout,
  overstock,
  barOnly = false,
}: {
  weeks: number | null;
  stockout: number | null;
  overstock: number | null;
  barOnly?: boolean;
}) {
  if (weeks == null || stockout == null || overstock == null) return <span className="muted">—</span>;
  const max = overstock * 1.25;
  const pct = Math.max(4, Math.min(100, (weeks / max) * 100));
  const color = weeks < stockout ? "var(--cover-low)" : weeks > overstock ? "var(--cover-high)" : "var(--cover-ok)";
  return (
    <span className={barOnly ? "cover bar-only" : "cover"} title={`Stockout below ${stockout} weeks, overstock above ${overstock} weeks`}>
      <span className="cover-bar">
        <span className="cover-fill" style={{ width: `${pct}%`, background: color }} />
      </span>
      <span className="cover-value">{fmt1(weeks)}</span>
    </span>
  );
}
