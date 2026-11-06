"use client";

import { useActionState } from "react";
import {
  importZohoMappingAction,
  saveZohoMappingAction,
  sendToZohoAction,
  suggestZohoMappingAction,
  type ActionState,
} from "@/app/actions";
import { RefreshIcon, SparkIcon, UploadIcon } from "@/components/icons";

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

/** "Send to Zoho as draft": every ready distributor at once, or one distributor (retry). */
export function SendToZohoForm({
  runId,
  distributorId,
  label,
  needsCheck = false,
  secondary = false,
}: {
  runId: number;
  distributorId?: string;
  label: string;
  /** For an "unknown" result: ask the user to confirm they checked Zoho first. */
  needsCheck?: boolean;
  secondary?: boolean;
}) {
  const [state, action, pending] = useActionState(sendToZohoAction, {});
  return (
    <form action={action} className="stack" style={{ gap: 6 }}>
      <input type="hidden" name="runId" value={runId} />
      {distributorId && <input type="hidden" name="distributorId" value={distributorId} />}
      {needsCheck && (
        <label className="check">
          <input type="checkbox" name="checkedZoho" value="1" required /> I checked Zoho and this PO isn&apos;t there
        </label>
      )}
      <div>
        <button type="submit" disabled={pending} className={secondary ? "secondary small" : undefined}>
          <UploadIcon size={secondary ? 14 : 16} />
          {pending ? "Sending to Zoho…" : label}
        </button>
      </div>
      <Status state={state} />
    </form>
  );
}

export interface MappingRow {
  ourId: string;
  label: string;
  meta?: string;
  zohoId: string;
  zohoName: string | null;
}

/** One form for every vendor and item mapping; empty a box to remove that mapping. */
export function ZohoMappingForm({ vendors, items }: { vendors: MappingRow[]; items: MappingRow[] }) {
  const [state, action, pending] = useActionState(saveZohoMappingAction, {});
  const section = (title: string, prefix: "vendor" | "item", rows: MappingRow[], placeholder: string) => (
    <div className="card">
      <h2>{title}</h2>
      <div className="table-wrap">
        <table className="table stack-table">
          <thead>
            <tr>
              <th>{prefix === "vendor" ? "Distributor" : "SKU"}</th>
              <th>Zoho {prefix === "vendor" ? "vendor" : "item"} ID</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.ourId}>
                <td data-label={prefix === "vendor" ? "Distributor" : "SKU"}>
                  <div className="product-name">{r.label}</div>
                  <div className="product-meta">
                    {r.ourId}
                    {r.meta ? ` · ${r.meta}` : ""}
                  </div>
                </td>
                <td data-label={`Zoho ${prefix} ID`}>
                  <input
                    name={`${prefix}:${r.ourId}`}
                    defaultValue={r.zohoId}
                    placeholder={placeholder}
                    aria-label={`Zoho ${prefix} ID for ${r.ourId}`}
                    style={{ width: "100%" }}
                  />
                  {r.zohoName && <div className="product-meta">Zoho: {r.zohoName}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
  return (
    <form action={action}>
      <div className="grid-2">
        {section("Distributors → Zoho vendors", "vendor", vendors, "e.g. 460000000012345")}
        {section("SKUs → Zoho items", "item", items, "e.g. 460000000067890")}
      </div>
      <div className="row" style={{ marginTop: 16 }}>
        <button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save mapping"}
        </button>
        <Status state={state} />
      </div>
    </form>
  );
}

export function ImportMappingForm() {
  const [state, action, pending] = useActionState(importZohoMappingAction, {});
  return (
    <form action={action} className="stack">
      <div className="row">
        <input type="file" name="file" accept=".csv,text/csv" required aria-label="zoho_mapping.csv" />
        <button type="submit" disabled={pending} className="secondary">
          <UploadIcon size={16} />
          {pending ? "Importing…" : "Import CSV"}
        </button>
      </div>
      <Status state={state} />
    </form>
  );
}

export function SuggestMappingForm({ enabled }: { enabled: boolean }) {
  const [state, action, pending] = useActionState(suggestZohoMappingAction, {});
  return (
    <form action={action} className="stack">
      <div>
        <button type="submit" disabled={pending || !enabled} className="secondary" title={enabled ? undefined : "Connect Zoho first"}>
          {pending ? <RefreshIcon size={16} /> : <SparkIcon size={16} />}
          {pending ? "Asking Zoho…" : "Suggest matches from Zoho"}
        </button>
      </div>
      <Status state={state} />
    </form>
  );
}
