"use client";

import { useActionState, useEffect, useState } from "react";
import {
  festivalMonthAction,
  generateExplanationsAction,
  recalculateAction,
  regenerateAction,
  reviewAction,
  saveThresholdsAction,
  syncZohoAction,
  uploadAction,
  type ActionState,
} from "@/app/actions";
import { CheckIcon, EditIcon, RefreshIcon, SparkIcon, UploadIcon, XIcon } from "@/components/icons";

const NAME_KEY = "freshroots.reviewer";
const NAME_EVENT = "freshroots:reviewer";

/** The reviewer's name, remembered in this browser only (no login yet) and shared by every form on the page. */
function useReviewerName(): [string, (v: string) => void] {
  const [name, setName] = useState("");
  useEffect(() => {
    try {
      setName(localStorage.getItem(NAME_KEY) ?? "");
    } catch {}
    const onChange = (e: Event) => setName((e as CustomEvent<string>).detail);
    window.addEventListener(NAME_EVENT, onChange);
    return () => window.removeEventListener(NAME_EVENT, onChange);
  }, []);
  const update = (v: string) => {
    try {
      localStorage.setItem(NAME_KEY, v);
    } catch {}
    window.dispatchEvent(new CustomEvent(NAME_EVENT, { detail: v }));
  };
  return [name, update];
}

function NameInput({ required = true }: { required?: boolean }) {
  const [name, setName] = useReviewerName();
  return (
    <input
      name="name"
      placeholder="Your name"
      value={name}
      onChange={(e) => setName(e.target.value)}
      required={required}
      className="name-input"
      aria-label="Your name"
    />
  );
}

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");

/** "Reviewing as …" bar: the name is entered once and used by every decision on the page. */
export function ReviewerBar() {
  const [name, setName] = useReviewerName();
  return (
    <div className="reviewer-bar">
      <span className="avatar" aria-hidden="true">
        {initials(name) || "?"}
      </span>
      <label htmlFor="reviewer-name" className="muted">
        Reviewing as
      </label>
      <input
        id="reviewer-name"
        placeholder="Your name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="name-input"
      />
      <span className="muted small">Saved in this browser and recorded with every decision.</span>
    </div>
  );
}

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
  const [name] = useReviewerName();
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="name" value={name} />
      <button type="submit" disabled={pending}>
        <RefreshIcon size={16} />
        {pending ? "Recalculating…" : "Recalculate"}
      </button>
      <Status state={state} />
    </form>
  );
}

export function GenerateExplanationsForm({ enabled }: { enabled: boolean }) {
  const [state, action, pending] = useActionState(generateExplanationsAction, {});
  return (
    <form action={action} className="inline-form">
      <label className="check" title="Ask Gemini again even where a reason already exists">
        <input type="checkbox" name="force" value="1" /> Redo all
      </label>
      <button
        type="submit"
        disabled={pending || !enabled}
        className="secondary"
        title={enabled ? undefined : "Set GEMINI_API_KEY to enable"}
      >
        <SparkIcon size={16} />
        {pending ? "Asking Gemini…" : "Generate AI reasons"}
      </button>
      <Status state={state} />
    </form>
  );
}

export function RegenerateForm({ recommendationId, enabled }: { recommendationId: number; enabled: boolean }) {
  const [state, action, pending] = useActionState(regenerateAction, {});
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="recommendationId" value={recommendationId} />
      <button type="submit" disabled={pending || !enabled} className="secondary small">
        <SparkIcon size={14} />
        {pending ? "Regenerating…" : "Regenerate"}
      </button>
      {!enabled && <span className="muted small">Set GEMINI_API_KEY to enable.</span>}
      <Status state={state} />
    </form>
  );
}

/**
 * Approve / Edit / Reject. Approve saves at once; Edit and Reject open a short form first.
 * With `askName`, the reviewer name is typed here; otherwise it comes from the ReviewerBar.
 */
export function ReviewForm({
  recommendationId,
  quantity,
  action: recommendedAction,
  compact = false,
  askName = false,
}: {
  recommendationId: number;
  quantity: number | null;
  action: string;
  compact?: boolean;
  askName?: boolean;
}) {
  const [state, action, pending] = useActionState(reviewAction, {});
  const [reviewer, setReviewer] = useReviewerName();
  const [mode, setMode] = useState<"EDIT" | "REJECT" | null>(null);
  const [nameError, setNameError] = useState(false);
  const isReorder = recommendedAction === "REORDER" && quantity != null;

  return (
    <form
      action={action}
      className={compact ? "review-form compact" : "review-form"}
      onSubmit={(e) => {
        if (!reviewer.trim()) {
          e.preventDefault();
          setNameError(true);
        }
      }}
    >
      <input type="hidden" name="recommendationId" value={recommendationId} />
      {askName ? (
        <input
          name="reviewer"
          placeholder="Your name"
          value={reviewer}
          onChange={(e) => {
            setReviewer(e.target.value);
            setNameError(false);
          }}
          aria-label="Reviewer name"
          className="name-input"
        />
      ) : (
        <input type="hidden" name="reviewer" value={reviewer} />
      )}

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
      {nameError && !reviewer.trim() && (
        <div className="status status-error">
          {askName ? "Enter your name first." : "Enter your name in the “Reviewing as” box first."}
        </div>
      )}
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
        <NameInput />
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
  const [name] = useReviewerName();
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="yearMonth" value={yearMonth} />
      <input type="hidden" name="isFestival" value={isFestival ? "0" : "1"} />
      <input type="hidden" name="name" value={name} />
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
      <NameInput />
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
        <NameInput />
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
        <NameInput />
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
