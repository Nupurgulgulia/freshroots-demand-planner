import { ACTION_LABELS, FLAG_LABELS, type Action, type Flag } from "@/lib/rules/engine";

export function FlagBadge({ flag }: { flag: string }) {
  return <span className={`badge flag-${flag}`}>{FLAG_LABELS[flag as Flag] ?? flag}</span>;
}

const STATUS_LABELS: Record<string, string> = {
  PENDING: "Pending review",
  APPROVED: "Approved",
  EDITED: "Approved (edited)",
  REJECTED: "Rejected",
  NO_ACTION: "—",
};

export function StatusBadge({ status }: { status: string }) {
  if (status === "NO_ACTION") return <span className="muted">—</span>;
  return <span className={`badge status-${status}`}>{STATUS_LABELS[status] ?? status}</span>;
}

export function actionText(action: string, quantity: number | null) {
  const label = ACTION_LABELS[action as Action] ?? action;
  return action === "REORDER" && quantity != null ? `${label}: ${quantity.toLocaleString("en-IN")}` : label;
}
