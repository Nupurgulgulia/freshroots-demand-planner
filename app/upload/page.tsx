import { desc } from "drizzle-orm";
import { UploadForm } from "@/components/forms";
import { DATASET_NAMES, datasetSchemas } from "@/lib/data/csv";
import { getDb, schema } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function UploadPage() {
  const db = await getDb();
  const uploads = await db.select().from(schema.uploads).orderBy(desc(schema.uploads.id)).limit(20);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Upload data</h1>
          <p className="muted">
            Each file is checked in full; if any row is invalid, nothing from that file is saved. Master data, sales and
            the calendar are updated by key. current_inventory replaces the stock snapshot.
          </p>
        </div>
      </div>

      <div className="card">
        <UploadForm datasets={DATASET_NAMES} />
      </div>

      <div className="grid-2">
        <div className="card">
          <h2>Expected files and columns</h2>
          <ul className="dataset-list">
            {DATASET_NAMES.map((d) => (
              <li key={d}>
                <strong>{d}.csv</strong>
                <div>
                  <code>{Object.keys(datasetSchemas[d].shape).join(", ")}</code>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="card">
          <h2>Recent uploads</h2>
          {uploads.length === 0 ? (
            <p className="muted">None yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Dataset</th>
                    <th className="num">Rows</th>
                    <th>By</th>
                  </tr>
                </thead>
                <tbody>
                  {uploads.map((u) => (
                    <tr key={u.id}>
                      <td className="muted">{fmtDateTime(u.uploadedAt)}</td>
                      <td>
                        <div style={{ fontWeight: 500 }}>{u.dataset}</div>
                        <div className="product-meta">{u.fileName}</div>
                      </td>
                      <td className="num">{u.rowCount}</td>
                      <td>{u.uploadedBy}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
