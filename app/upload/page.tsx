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
      <h1>Upload data</h1>
      <p className="muted">
        Upload one or more CSVs. Each file is checked in full; if any row is invalid, nothing from that file is saved.
        Master data, sales and the calendar are updated by key. current_inventory replaces the stock snapshot.
      </p>

      <div className="card">
        <UploadForm datasets={DATASET_NAMES} />
      </div>

      <div className="grid-2">
        <div className="card">
          <h2>Expected columns</h2>
          <ul>
            {DATASET_NAMES.map((d) => (
              <li key={d}>
                <strong>{d}.csv</strong>: {Object.keys(datasetSchemas[d].shape).join(", ")}
              </li>
            ))}
          </ul>
        </div>
        <div className="card">
          <h2>Recent uploads</h2>
          {uploads.length === 0 ? (
            <p className="muted">None yet.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Dataset</th>
                  <th>File</th>
                  <th className="num">Rows</th>
                  <th>By</th>
                </tr>
              </thead>
              <tbody>
                {uploads.map((u) => (
                  <tr key={u.id}>
                    <td>{fmtDateTime(u.uploadedAt)}</td>
                    <td>{u.dataset}</td>
                    <td>{u.fileName}</td>
                    <td className="num">{u.rowCount}</td>
                    <td>{u.uploadedBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
