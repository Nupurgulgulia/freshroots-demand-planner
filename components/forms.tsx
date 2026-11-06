"use client";

import { useActionState, useState } from "react";
import {
  festivalMonthAction,
  generateExplanationsAction,
  recalculateAction,
  regenerateAction,
  reviewAction,
  saveThresholdsAction,
  confirmQuantityAction,
  syncZohoAction,
  uploadAction,
  changePasswordAction,
  type ActionState,
} from "@/app/actions";
import { PasswordInput } from "@/components/PasswordInput";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-rules";
import { CheckIcon, EditIcon, RefreshIcon, SparkIcon, UploadIcon, XIcon } from "@/components/icons";

function Status({ state }: { state: ActionState }) {
  if (!state.message && !state.errors?.length) return null;
  return (
    <div className={`status ${state.ok ? "status-ok" : "status-error"}`} role="status">
      {state.message && <div className="pre">{state.message}</div>}
      {state.errors?.length ? (
        <ul>
          {state.errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function RecalculateForm() {
  const [state, action, pending] = useActionState(recalculateAction, {});
  return (
    <form action={action} className="inline-form">
      <button type="submit" disabled={pending}>
        <RefreshIcon size={16} />
        {pending ? "Recalculating…" : "Recalculate"}
      </button>
      <Status state={state} />
    </form>
  );
}

export interface AiUsageInfo {
  calls: number;
  cap: number;
  capReached: boolean;
  message: string;
}

export function GenerateExplanationsForm({ enabled, usage }: { enabled: boolean; usage?: AiUsageInfo }) {
  const [state, action, pending] = useActionState(generateExplanationsAction, {});
  const capped = usage?.capReached ?? false;
  return (
    <form action={action} className="inline-form" title={usage ? `AI calls this month: ${usage.calls} of ${usage.cap}` : undefined}>
      <label className="check" title="Ask Gemini again even where a reason already exists">
        <input type="checkbox" name="force" value="1" /> Redo all
      </label>
      <button
        type="submit"
        disabled={pending || !enabled || capped}
        className="secondary"
        title={!enabled ? "Set GEMINI_API_KEY to enable" : capped ? usage?.message : undefined}
      >
        <SparkIcon size={16} />
        {pending ? "Asking Gemini…" : "Generate AI reasons"}
      </button>
      {capped && <div className="status status-error">{usage?.message}</div>}
      <Status state={state} />
    </form>
  );
}

export function RegenerateForm({
  recommendationId,
  enabled,
  capMessage,
}: {
  recommendationId: number;
  enabled: boolean;
  /** Set when this month's AI limit is used up. */
  capMessage?: string;
}) {
  const [state, action, pending] = useActionState(regenerateAction, {});
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="recommendationId" value={recommendationId} />
      <button type="submit" disabled={pending || !enabled || !!capMessage} className="secondary small" title={capMessage}>
        <SparkIcon size={14} />
        {pending ? "Regenerating…" : "Regenerate"}
      </button>
      {!enabled && <span className="muted small">Set GEMINI_API_KEY to enable.</span>}
      {enabled && capMessage && <span className="muted small">Monthly AI limit reached.</span>}
      <Status state={state} />
    </form>
  );
}

/** Approve / Edit / Reject. Approve saves at once; Edit and Reject open a short form first. The reviewer is the signed-in user. */
export function ReviewForm({
  recommendationId,
  quantity,
  action: recommendedAction,
  compact = false,
}: {
  recommendationId: number;
  quantity: number | null;
  action: string;
  compact?: boolean;
}) {
  const [state, action, pending] = useActionState(reviewAction, {});
  const [mode, setMode] = useState<"EDIT" | "REJECT" | null>(null);
  const isReorder = recommendedAction === "REORDER" && quantity != null;

  return (
    <form action={action} className={compact ? "review-form compact" : "review-form"}>
      <input type="hidden" name="recommendationId" value={recommendationId} />

      {mode === null ? (
        <>
          <input name="note" placeholder="Note (optional)" aria-label="Note" />
          <div className="decision-buttons">
            <button type="submit" name="decision" value="APPROVE" disabled={pending}>
              <CheckIcon size={15} />
              {pending ? "Saving…" : isReorder ? `Approve ${quantity!.toLocaleString("en-IN")}` : "Approve"}
            </button>
            {isReorder && (
              <button type="button" className="ghost" onClick={() => setMode("EDIT")}>
                <EditIcon size={14} /> Edit
              </button>
            )}
            <button type="button" className="danger" onClick={() => setMode("REJECT")}>
              <XIcon size={14} /> Reject
            </button>
          </div>
        </>
      ) : (
        <>
          <input type="hidden" name="decision" value={mode} />
          {mode === "EDIT" && (
            <input
              name="quantity"
              type="number"
              min={0}
              step={1}
              defaultValue={quantity ?? ""}
              placeholder="Units"
              required
              aria-label="Final quantity"
              className="qty-input"
              autoFocus
            />
          )}
          <input
            name="note"
            placeholder={mode === "EDIT" ? "Why change the quantity?" : "Why reject?"}
            required
            aria-label="Note"
            autoFocus={mode === "REJECT"}
          />
          <div className="decision-buttons">
            <button type="submit" disabled={pending} className={mode === "REJECT" ? "danger solid" : undefined}>
              {pending ? "Saving…" : mode === "EDIT" ? "Save quantity" : "Confirm reject"}
            </button>
            <button type="button" className="ghost" onClick={() => setMode(null)}>
              Cancel
            </button>
          </div>
        </>
      )}
      <Status state={state} />
    </form>
  );
}

/** Procurement's tick-and-confirm for a quantity above the confirmation limit. */
export function ConfirmQuantityForm({ recommendationId }: { recommendationId: number }) {
  const [state, action, pending] = useActionState(confirmQuantityAction, {});
  return (
    <form action={action} className="confirm-form">
      <input type="hidden" name="recommendationId" value={recommendationId} />
      <label className="check">
        <input type="checkbox" name="checked" value="1" required /> I've checked this quantity
      </label>
      <div className="row">
        <input name="note" placeholder="Note (optional)" aria-label="Confirmation note" className="note-input" />
        <button type="submit" disabled={pending} className="small">
          <CheckIcon size={14} />
          {pending ? "Confirming…" : "Confirm"}
        </button>
      </div>
      <Status state={state} />
    </form>
  );
}

export function ThresholdsForm({
  defs,
}: {
  defs: { key: string; label: string; unit: string; display: number }[];
}) {
  const [state, action, pending] = useActionState(saveThresholdsAction, {});
  return (
    <form action={action} className="stack">
      <table className="table plain">
        <tbody>
          {defs.map((d) => (
            <tr key={d.key}>
              <td>
                <label htmlFor={d.key}>{d.label}</label>
              </td>
              <td className="num">
                <input
                  id={d.key}
                  name={d.key}
                  type="number"
                  step="any"
                  min={0}
                  defaultValue={d.display}
                  required
                  className="qty-input"
                />{" "}
                <span className="muted" style={{ display: "inline-block", width: 44, textAlign: "left" }}>
                  {d.unit === "percent" ? "%" : d.unit === "multiplier" ? "×" : "weeks"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row">
        <input name="note" placeholder="Why the change? (optional)" className="note-input" />
        <button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save thresholds"}
        </button>
      </div>
      <Status state={state} />
    </form>
  );
}

export function FestivalToggle({ yearMonth, isFestival }: { yearMonth: string; isFestival: boolean }) {
  const [state, action, pending] = useActionState(festivalMonthAction, {});
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="yearMonth" value={yearMonth} />
      <input type="hidden" name="isFestival" value={isFestival ? "0" : "1"} />
      <button type="submit" disabled={pending} className="link-button">
        {isFestival ? "Unmark" : "Mark as festival"}
      </button>
      {state.ok === false && <span className="error-text">{state.message}</span>}
    </form>
  );
}

export function AddFestivalMonthForm() {
  const [state, action, pending] = useActionState(festivalMonthAction, {});
  return (
    <form action={action} className="row">
      <input name="yearMonth" placeholder="2026-11" pattern="\d{4}-\d{2}" required aria-label="Month (YYYY-MM)" />
      <select name="isFestival" defaultValue="1" aria-label="Festival month">
        <option value="1">Festival month</option>
        <option value="0">Not a festival month</option>
      </select>
      <button type="submit" disabled={pending}>
        Save month
      </button>
      <Status state={state} />
    </form>
  );
}

export function ZohoSyncForm({ configured }: { configured: boolean }) {
  const [state, action, pending] = useActionState(syncZohoAction, {});
  return (
    <form action={action} className="stack">
      <div className="row">
        <label className="check">
          <input type="checkbox" name="rerun" value="1" defaultChecked /> Recalculate after syncing
        </label>
        <button
          type="submit"
          disabled={pending || !configured}
          title={configured ? undefined : "Set the ZOHO_* settings to enable"}
          style={{ marginLeft: "auto" }}
        >
          <RefreshIcon size={16} />
          {pending ? "Syncing…" : "Sync from Zoho"}
        </button>
      </div>
      <Status state={state} />
    </form>
  );
}

export function UploadForm({ datasets }: { datasets: string[] }) {
  const [state, action, pending] = useActionState(uploadAction, {});
  const [files, setFiles] = useState<string[]>([]);
  const [drag, setDrag] = useState(false);
  return (
    <form action={action} className="stack">
      <label
        className={`dropzone ${drag ? "drag" : ""}`}
        onDragOver={() => setDrag(true)}
        onDragLeave={() => setDrag(false)}
        onDrop={() => setDrag(false)}
      >
        <span className="dz-icon">
          <UploadIcon size={22} />
        </span>
        <strong style={{ color: "var(--text)" }}>
          {files.length ? `${files.length} file${files.length > 1 ? "s" : ""} selected` : "Drop CSV files here"}
        </strong>
        <span className="small">{files.length ? files.join(", ") : "or click to choose. You can pick several at once."}</span>
        <input
          type="file"
          name="files"
          accept=".csv,text/csv"
          multiple
          required
          aria-label="CSV files"
          onChange={(e) => setFiles(Array.from(e.target.files ?? []).map((f) => f.name))}
        />
      </label>
      <div className="row">
        <select name="dataset" defaultValue="" aria-label="Dataset">
          <option value="">Detect dataset from file name</option>
          {datasets.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <label className="check">
          <input type="checkbox" name="rerun" value="1" defaultChecked /> Recalculate after loading
        </label>
        <button type="submit" disabled={pending} style={{ marginLeft: "auto" }}>
          <UploadIcon size={16} />
          {pending ? "Uploading…" : "Upload"}
        </button>
      </div>
      <Status state={state} />
    </form>
  );
}

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, {});
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const longEnough = next.length >= MIN_PASSWORD_LENGTH;
  const matches = confirm.length > 0 && next === confirm;
  return (
    <form action={action} className="stack" style={{ maxWidth: 380 }}>
      <PasswordInput name="current" placeholder="Current password" autoComplete="current-password" />
      <PasswordInput
        name="next"
        placeholder="New password"
        autoComplete="new-password"
        minLength={MIN_PASSWORD_LENGTH}
        onValueChange={setNext}
        hint={
          <span className={next && longEnough ? "pw-ok" : undefined}>
            {next && longEnough ? "✓ " : ""}At least {MIN_PASSWORD_LENGTH} characters. A few random words with a number
            is easy to remember and hard to guess.
          </span>
        }
      />
      <PasswordInput
        name="confirm"
        placeholder="New password again"
        autoComplete="new-password"
        minLength={MIN_PASSWORD_LENGTH}
        onValueChange={setConfirm}
        hint={
          confirm ? (
            <span className={matches ? "pw-ok" : "pw-bad"}>{matches ? "✓ Passwords match" : "Passwords don't match yet"}</span>
          ) : undefined
        }
      />
      <button type="submit" disabled={pending} style={{ justifySelf: "start" }}>
        {pending ? "Saving…" : "Change password"}
      </button>
      <Status state={state} />
    </form>
  );
}
