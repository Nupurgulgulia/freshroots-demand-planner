// Parses and validates the input CSVs (five required, plus optional open POs). Pure: no database access.

import Papa from "papaparse";
import { z } from "zod";
import { isValidIsoWeek } from "@/lib/rules/weeks";

const text = z.string().trim().min(1);
const intNonNeg = z.coerce.number().int().nonnegative();
const isoDate = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const bool = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase())
  .refine((v) => ["TRUE", "FALSE", "1", "0", "YES", "NO"].includes(v), "expected TRUE or FALSE")
  .transform((v) => v === "TRUE" || v === "1" || v === "YES");

export const datasetSchemas = {
  weekly_sales: z.object({
    SKU_ID: text,
    Week: z.string().trim().refine(isValidIsoWeek, "expected ISO week like 2026-W42"),
    Units_Sold: intNonNeg,
  }),
  sku_master: z.object({
    SKU_ID: text,
    SKU_Name: text,
    Category: text,
    Perishability: z.enum(["Low", "High"]),
    Standard_Reorder_Qty: z.coerce.number().int().positive(),
    Unit_of_Measure: text,
    Distributor_ID: text,
  }),
  distributor_master: z.object({
    Distributor_ID: text,
    Distributor_Name: text,
    Region: text,
    Status: text,
  }),
  current_inventory: z.object({
    SKU_ID: text,
    Location: text,
    Units_On_Hand: intNonNeg,
    As_Of_Date: isoDate,
  }),
  calendar: z.object({
    Year: z.coerce.number().int(),
    Month: z.coerce.number().int().min(1).max(12),
    Year_Month: z.string().trim().regex(/^\d{4}-\d{2}$/, "expected YYYY-MM"),
    Is_Festival_Month: bool,
  }),
  // Optional: purchase orders placed but not fully received (a CSV export, or synced from Zoho Inventory).
  open_purchase_orders: z
    .object({
      PO_Number: text,
      SKU_ID: text,
      Ordered_Qty: intNonNeg,
      Received_Qty: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? 0 : v), intNonNeg),
      Expected_Date: z.union([isoDate, z.string().trim().length(0)]).transform((v) => v || null),
      Status: text,
    })
    .refine((r) => r.Received_Qty <= r.Ordered_Qty, {
      message: "Received_Qty is more than Ordered_Qty",
      path: ["Received_Qty"],
    }),
} as const;

export type DatasetName = keyof typeof datasetSchemas;
export const DATASET_NAMES = Object.keys(datasetSchemas) as DatasetName[];
/** Datasets the seed script loads only when the file exists. */
export const OPTIONAL_DATASETS: DatasetName[] = ["open_purchase_orders"];

export function datasetColumns(dataset: DatasetName): string[] {
  return Object.keys(datasetSchemas[dataset].shape);
}
export type DatasetRow<D extends DatasetName> = z.infer<(typeof datasetSchemas)[D]>;

/** Columns that must be unique together within one file. */
const keyColumns: Record<DatasetName, string[]> = {
  weekly_sales: ["SKU_ID", "Week"],
  sku_master: ["SKU_ID"],
  distributor_master: ["Distributor_ID"],
  current_inventory: ["SKU_ID", "Location"],
  calendar: ["Year_Month"],
  open_purchase_orders: ["PO_Number", "SKU_ID"],
};

export interface ParseResult<D extends DatasetName> {
  rows: DatasetRow<D>[];
  errors: string[];
}

export function parseDataset<D extends DatasetName>(dataset: D, csv: string): ParseResult<D> {
  const schema = datasetSchemas[dataset];
  const parsed = Papa.parse<Record<string, string>>(csv.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });
  const errors: string[] = parsed.errors.map((e) => `Row ${(e.row ?? 0) + 2}: ${e.message}`);

  const expected = datasetColumns(dataset);
  const missing = expected.filter((c) => !parsed.meta.fields?.includes(c));
  if (missing.length) {
    return { rows: [], errors: [`Missing column(s): ${missing.join(", ")}`] };
  }

  const rows: DatasetRow<D>[] = [];
  const seen = new Set<string>();
  parsed.data.forEach((raw, i) => {
    const line = i + 2; // header is line 1
    const result = schema.safeParse(raw);
    if (!result.success) {
      for (const issue of result.error.issues) {
        errors.push(`Row ${line}, ${issue.path.join(".")}: ${issue.message}`);
      }
      return;
    }
    const row = result.data as Record<string, unknown>;
    const key = keyColumns[dataset].map((c) => row[c]).join("|");
    if (seen.has(key)) {
      errors.push(`Row ${line}: duplicate ${keyColumns[dataset].join(" + ")} (${key})`);
      return;
    }
    seen.add(key);
    rows.push(result.data as DatasetRow<D>);
  });
  return { rows, errors };
}

/** Guesses the dataset from a file name like "weekly_sales.csv". */
export function datasetFromFileName(name: string): DatasetName | null {
  const base = name.toLowerCase().replace(/\.csv$/, "");
  return DATASET_NAMES.find((d) => base === d) ?? null;
}
