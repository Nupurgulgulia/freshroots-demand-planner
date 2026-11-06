import { describe, expect, it } from "vitest";
import { datasetFromFileName, parseDataset } from "./csv";

describe("parseDataset", () => {
  it("parses valid rows and coerces types", () => {
    const { rows, errors } = parseDataset(
      "calendar",
      "Year,Month,Year_Month,Is_Festival_Month\n2026,10,2026-10,TRUE\n2026,9,2026-09,false\n",
    );
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { Year: 2026, Month: 10, Year_Month: "2026-10", Is_Festival_Month: true },
      { Year: 2026, Month: 9, Year_Month: "2026-09", Is_Festival_Month: false },
    ]);
  });

  it("reports missing columns", () => {
    const { errors } = parseDataset("weekly_sales", "SKU_ID,Week\nSKU001,2026-W42\n");
    expect(errors).toEqual(["Missing column(s): Units_Sold"]);
  });

  it("reports bad values and duplicates with line numbers", () => {
    const { rows, errors } = parseDataset(
      "weekly_sales",
      "SKU_ID,Week,Units_Sold\nSKU001,2026-W42,10\nSKU001,2026-42,10\nSKU001,2026-W41,-3\nSKU001,2026-W42,11\n",
    );
    expect(rows).toHaveLength(1);
    expect(errors).toHaveLength(3);
    expect(errors[0]).toMatch(/^Row 3, Week/);
    expect(errors[1]).toMatch(/^Row 4, Units_Sold/);
    expect(errors[2]).toMatch(/^Row 5: duplicate/);
  });

  it("rejects unknown perishability values", () => {
    const { errors } = parseDataset(
      "sku_master",
      "SKU_ID,SKU_Name,Category,Perishability,Standard_Reorder_Qty,Unit_of_Measure,Distributor_ID\nS1,N,C,Medium,10,Units,D1\n",
    );
    expect(errors[0]).toMatch(/Perishability/);
  });

  it("recognises dataset file names", () => {
    expect(datasetFromFileName("weekly_sales.csv")).toBe("weekly_sales");
    expect(datasetFromFileName("Calendar.CSV")).toBe("calendar");
    expect(datasetFromFileName("other.csv")).toBeNull();
  });
});

describe("open_purchase_orders.csv", () => {
  const header = "PO_Number,SKU_ID,Ordered_Qty,Received_Qty,Expected_Date,Status";

  it("accepts blank received quantity and expected date", () => {
    const { rows, errors } = parseDataset("open_purchase_orders", `${header}\nPO-1,SKU001,300,,,Open\nPO-1,SKU003,200,50,2026-11-20,Partially Received`);
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({ Received_Qty: 0, Expected_Date: null });
    expect(rows[1]).toMatchObject({ Received_Qty: 50, Expected_Date: "2026-11-20" });
  });

  it("rejects receiving more than was ordered, and duplicate PO lines", () => {
    const { errors } = parseDataset("open_purchase_orders", `${header}\nPO-1,SKU001,100,150,,Open\nPO-2,SKU001,10,0,,Open\nPO-2,SKU001,20,0,,Open`);
    expect(errors.join("\n")).toMatch(/more than Ordered_Qty/);
    expect(errors.join("\n")).toMatch(/duplicate PO_Number \+ SKU_ID/);
  });
});

describe("optional Unit_Price in sku_master.csv", () => {
  const header = "SKU_ID,SKU_Name,Category,Perishability,Standard_Reorder_Qty,Unit_of_Measure,Distributor_ID";

  it("works without the column, and reports which columns were present", () => {
    const { rows, errors, columns } = parseDataset("sku_master", `${header}\nS1,Rice,Staple,Low,100,Units,D1`);
    expect(errors).toEqual([]);
    expect(rows[0].Unit_Price).toBeUndefined();
    expect(columns).not.toContain("Unit_Price");
  });

  it("reads prices, allows blanks, and rejects negatives", () => {
    const ok = parseDataset("sku_master", `${header},Unit_Price\nS1,Rice,Staple,Low,100,Units,D1,42.5\nS2,Oats,Staple,Low,50,Units,D1,`);
    expect(ok.errors).toEqual([]);
    expect(ok.rows.map((r) => r.Unit_Price)).toEqual([42.5, undefined]);
    const bad = parseDataset("sku_master", `${header},Unit_Price\nS1,Rice,Staple,Low,100,Units,D1,-3`);
    expect(bad.errors.join(" ")).toMatch(/Unit_Price/);
  });
});
