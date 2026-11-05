import { describe, expect, it } from "vitest";
import { isCorrectPassword, isValidSession, safeNextPath, sessionToken } from "./auth";

describe("shared-password gate", () => {
  it("accepts only the right password", () => {
    expect(isCorrectPassword("open sesame", "open sesame")).toBe(true);
    expect(isCorrectPassword("open sesam", "open sesame")).toBe(false);
    expect(isCorrectPassword("", "open sesame")).toBe(false);
  });

  it("validates the session cookie against the current password", () => {
    const token = sessionToken("pw-1");
    expect(isValidSession(token, "pw-1")).toBe(true);
    expect(isValidSession(token, "pw-2")).toBe(false); // password changed -> signed out
    expect(isValidSession(undefined, "pw-1")).toBe(false);
    expect(isValidSession("garbage", "pw-1")).toBe(false);
  });

  it("only redirects to same-site paths after login", () => {
    expect(safeNextPath("/sku/SKU001")).toBe("/sku/SKU001");
    expect(safeNextPath("https://evil.example")).toBe("/");
    expect(safeNextPath("//evil.example")).toBe("/");
    expect(safeNextPath("/\\evil.example")).toBe("/");
    expect(safeNextPath(null)).toBe("/");
  });
});
