import { describe, expect, it } from "vitest";
import { dateToIsoWeek, isValidIsoWeek, isoWeekMonday, weeksEndingAt } from "./weeks";

describe("ISO weeks", () => {
  it("finds the Monday of a week", () => {
    expect(isoWeekMonday("2026-W42").toISOString().slice(0, 10)).toBe("2026-10-12");
    expect(isoWeekMonday("2026-W01").toISOString().slice(0, 10)).toBe("2025-12-29");
  });

  it("converts dates to ISO weeks across year boundaries", () => {
    expect(dateToIsoWeek(new Date("2026-10-19T00:00:00Z"))).toBe("2026-W43");
    expect(dateToIsoWeek(new Date("2027-01-01T00:00:00Z"))).toBe("2026-W53");
    expect(dateToIsoWeek(new Date("2025-12-29T00:00:00Z"))).toBe("2026-W01");
  });

  it("validates week strings, including 53-week years", () => {
    expect(isValidIsoWeek("2026-W42")).toBe(true);
    expect(isValidIsoWeek("2026-W53")).toBe(true);
    expect(isValidIsoWeek("2025-W53")).toBe(false);
    expect(isValidIsoWeek("2026-W00")).toBe(false);
    expect(isValidIsoWeek("2026-42")).toBe(false);
  });

  it("lists trailing weeks oldest first", () => {
    expect(weeksEndingAt("2026-W42", 4)).toEqual(["2026-W39", "2026-W40", "2026-W41", "2026-W42"]);
    expect(weeksEndingAt("2027-W02", 4)).toEqual(["2026-W52", "2026-W53", "2027-W01", "2027-W02"]);
  });
});
