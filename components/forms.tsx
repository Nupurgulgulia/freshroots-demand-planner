"use client";

import { useActionState, useEffect, useState } from "react";
import {
  festivalMonthAction,
  generateExplanationsAction,
  recalculateAction,
  regenerateAction,
  reviewAction,
  saveThresholdsAction,
  uploadAction,
  type ActionState,
} from "@/app/actions";

const NAME_KEY = "freshroots.reviewer";

/** The reviewer's name, remembered in this browser only (no login yet). */
function useReviewerName(): [string, (v: string) => void] {
  const [name, setName] = useState("");
  useEffect(() => {
    try {
      setName(localStorage.getItem(NAME_KEY) ?? "");
    } catch {}
  }, []);
  const update = (v: string) => {
    setName(v);
    try {
      localStorage.setItem(NAME_KEY, v);
    } catch {}
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
      <NameInput required={false} />
      <button type="submit" disabled={pending}>
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
      <button type="submit" disabled={pending || !enabled} className="secondary">
        {pending ? "Asking Gemini…" : "Generate AI reasons"}
      </button>
      <label className="check">
        <input type="checkbox" name="force" value="1" /> regenerate all
      </label>
      {!enabled && <span className="muted">Set GEMINI_API_KEY to enable.</span>}
      <Status state={state} />
    </form>
  );
}

export function RegenerateForm({ recommendationId, enabled }: { recommendationId: number; enabled: boolean }) {
  const [state, action, pending] = useActionState(regenerateAction, {});
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="recommendationId" value={recommendationId} />
      <button type="submit" disabled={pending || !enabled} className="secondary">
        {pending ? "Regenerating…" : "Regenerate"}
      </button>
      {!enabled && <span className="muted">Set GEMINI_API_KEY to enable.</span>}
      <Status state={state} />
    </form>
  );
}

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
  const [reviewer, setReviewer] = useReviewerName();
  const [decision, setDecision] = useState<"APPROVE" | "EDIT" | "REJECT">("APPROVE");
  return (
    <form action={action} className={compact ? "review-form compact" : "review-form"}>
      <input type="hidden" name="recommendationId" value={recommendationId} />
      <input type="hidden" name="decision" value={decision} />
      <div className="row">
        <input
          name="reviewer"
          placeholder="Your name"
          value={reviewer}
          onChange={(e) => setReviewer(e.target.value)}
          required
          aria-label="Reviewer name"
        />
        <select
          value={decision}
          onChange={(e) => setDecision(e.target.value as typeof decision)}
          aria-label="Decision"
        >
          <option value="APPROVE">
            Approve{recommendedAction === "REORDER" && quantity != null ? ` (${quantity})` : ""}
          </option>
          <option value="EDIT">Edit quantity</option>
          <option value="REJECT">Reject</option>
        </select>
        {decision === "EDIT" && (
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
          />
        )}
      </div>
      <div className="row">
        <input
          name="note"
          placeholder={decision === "APPROVE" ? "Note (optional)" : "Note (required)"}
          required={decision !== "APPROVE"}
          aria-label="Note"
          className="note-input"
        />
        <button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
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
      <table className="table narrow">
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
                <span className="muted">{d.unit === "percent" ? "%" : d.unit === "multiplier" ? "×" : "weeks"}</span>
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
      <input name="yearMonth" placeholder="YYYY-MM" pattern="\d{4}-\d{2}" required aria-label="Month" />
      <select name="isFestival" defaultValue="1" aria-label="Festival month">
        <option value="1">Festival month</option>
        <option value="0">Not a festival month</option>
      </select>
      <NameInput />
      <button type="submit" disabled={pending}>
        Add / update month
      </button>
      <Status state={state} />
    </form>
  );
}

export function UploadForm({ datasets }: { datasets: string[] }) {
  const [state, action, pending] = useActionState(uploadAction, {});
  return (
    <form action={action} className="stack">
      <div className="row">
        <input type="file" name="files" accept=".csv,text/csv" multiple required aria-label="CSV files" />
        <select name="dataset" defaultValue="" aria-label="Dataset">
          <option value="">Detect from file name</option>
          {datasets.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </div>
      <div className="row">
        <NameInput />
        <label className="check">
          <input type="checkbox" name="rerun" value="1" defaultChecked /> Recalculate after loading
        </label>
        <button type="submit" disabled={pending}>
          {pending ? "Uploading…" : "Upload"}
        </button>
      </div>
      <Status state={state} />
    </form>
  );
}
