import Papa from "papaparse";
import { getDb } from "@/lib/db";
import { getApprovedOrders } from "@/lib/review";
import { getLatestRun } from "@/lib/run-engine";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = await getDb();
  const run = await getLatestRun(db);
  const orders = run ? await getApprovedOrders(db, run.id) : [];
  const csv = Papa.unparse(
    orders.map((o) => ({
      Run_ID: run?.id,
      Week: run?.nowWeek,
      Distributor_ID: o.distributorId,
      Distributor_Name: o.distributorName,
      SKU_ID: o.skuId,
      SKU_Name: o.skuName,
      Recommended_Qty: o.recommendedQuantity,
      Final_Qty: o.finalQuantity,
      Unit_of_Measure: o.unitOfMeasure,
      Status: o.status,
      Approved_By: o.reviewedBy,
      Approved_At: o.reviewedAt ? new Date(o.reviewedAt).toISOString() : "",
      Note: o.reviewNote ?? "",
    })),
  );
  const name = `approved_orders_${run?.nowWeek ?? "none"}_run${run?.id ?? 0}.csv`;
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
    },
  });
}
