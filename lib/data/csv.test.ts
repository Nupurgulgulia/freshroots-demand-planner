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
