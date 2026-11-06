import { describe, expect, it } from "vitest";
import {
  LOCKOUT,
  afterFailedAttempt,
  checkNewPassword,
  checkUsername,
  hashPassword,
  lockStatus,
  safeNextPath,
  verifyPassword,
} from "./auth";
import { parseInviteArgs } from "./invite-args";
import { can, canOpen, permissionForPath } from "./permissions";

describe("passwords", () => {
  it("accepts only the right password", () => {
    const stored = hashPassword("open sesame 123");
    expect(verifyPassword("open sesame 123", stored)).toBe(true);
    expect(verifyPassword("open sesame 12", stored)).toBe(false);
    expect(verifyPassword("", stored)).toBe(false);
    expect(verifyPassword("open sesame 123", "garbage")).toBe(false);
  });

  it("never stores the password itself, and salts every hash", () => {
    const a = hashPassword("open sesame 123");
    const b = hashPassword("open sesame 123");
    expect(a).not.toContain("open sesame");
    expect(a).not.toBe(b);
  });

  it("checks new passwords and usernames", () => {
    expect(checkNewPassword("short")).toMatch(/at least 10/);
    expect(checkNewPassword(" leading-space-pw")).toMatch(/space/);
    expect(checkNewPassword("long enough pw")).toBeNull();
    expect(checkUsername("raghav")).toBeNull();
    expect(checkUsername("Ra")).not.toBeNull();
    expect(checkUsername("bad name")).not.toBeNull();
  });

  it("only redirects to same-site paths after login", () => {
    expect(safeNextPath("/sku/SKU001")).toBe("/sku/SKU001");
    expect(safeNextPath("https://evil.example")).toBe("/");
    expect(safeNextPath("//evil.example")).toBe("/");
    expect(safeNextPath("/\\evil.example")).toBe("/");
    expect(safeNextPath(null)).toBe("/");
  });
});

describe("login lockout", () => {
  const now = new Date("2026-11-06T10:00:00Z");
  const fail = (n: number, start = now) => {
    let s = null as ReturnType<typeof afterFailedAttempt> | null;
    for (let i = 0; i < n; i++) s = afterFailedAttempt(s, start);
    return s!;
  };

  it("locks after 5 failures in a row, for 15 minutes", () => {
    expect(lockStatus(fail(4), now).locked).toBe(false);
    const s = fail(5);
    expect(s.failedCount).toBe(LOCKOUT.maxFailures);
    expect(lockStatus(s, now)).toEqual({ locked: true, minutesLeft: 15 });
    expect(lockStatus(s, new Date(now.getTime() + 14 * 60_000)).minutesLeft).toBe(1);
    expect(lockStatus(s, new Date(now.getTime() + 15 * 60_000)).locked).toBe(false);
  });

  it("starts a fresh count once the lock has expired", () => {
    const later = new Date(now.getTime() + 16 * 60_000);
    const s = afterFailedAttempt(fail(5), later);
    expect(s).toEqual({ failedCount: 1, lockedUntil: null });
  });
});

describe("roles", () => {
  it("lets only planners change data", () => {
    for (const p of ["review", "upload", "recalculate", "generateAi", "editSettings"] as const) {
      expect(can("planner", p)).toBe(true);
      expect(can("procurement", p)).toBe(false);
      expect(can("viewer", p)).toBe(false);
    }
  });

  it("gives procurement orders, export, confirmation and Zoho", () => {
    for (const p of ["viewApproved", "exportOrders", "confirmLargeQty", "sendToZoho"] as const) {
      expect(can("procurement", p)).toBe(true);
    }
    expect(can("planner", "sendToZoho")).toBe(false);
    expect(can("planner", "confirmLargeQty")).toBe(false);
  });

  it("limits viewers to the dashboard and Performance", () => {
    expect(canOpen("viewer", "/")).toBe(true);
    expect(canOpen("viewer", "/performance")).toBe(true);
    for (const path of ["/review", "/sku/SKU001", "/approved", "/approved/export", "/upload", "/settings"]) {
      expect(canOpen("viewer", path)).toBe(false);
    }
    expect(canOpen(null, "/")).toBe(false);
  });

  it("maps paths to permissions, most specific first", () => {
    expect(permissionForPath("/approved/export")).toBe("exportOrders");
    expect(permissionForPath("/approved")).toBe("viewApproved");
    expect(permissionForPath("/reviewer-notes")).toBeNull();
    expect(permissionForPath("/account")).toBeNull();
  });
});

describe("npm run invite arguments", () => {
  it("parses an invite and a reset", () => {
    expect(parseInviteArgs(["--username", "raghav", "--role", "planner", "--email", "r@x.in"])).toEqual({
      command: { kind: "upsert", username: "raghav", role: "planner", email: "r@x.in", reset: false },
    });
    const reset = parseInviteArgs(["--username", "a", "--role", "viewer", "--email", "a@x.in", "--reset"]);
    expect("command" in reset && reset.command.kind === "upsert" && reset.command.reset).toBe(true);
  });

  it("parses a role-only change, which needs no email or password", () => {
    expect(parseInviteArgs(["--username", "deepa", "--role", "viewer", "--role-only"])).toEqual({
      command: { kind: "setRole", username: "deepa", role: "viewer" },
    });
    expect(parseInviteArgs(["--username", "d", "--role", "viewer", "--role-only", "--reset"])).toEqual({
      error: expect.stringMatching(/--role-only/),
    });
  });

  it("parses a credentials check", () => {
    expect(parseInviteArgs(["--username", "nupur", "--check"])).toEqual({ command: { kind: "check", username: "nupur" } });
  });

  it("parses disable and enable", () => {
    expect(parseInviteArgs(["--username", "deepa", "--disable"])).toEqual({
      command: { kind: "setActive", username: "deepa", active: false },
    });
  });

  it("refuses a password on the command line and missing or unknown options", () => {
    expect(parseInviteArgs(["--username", "a", "--password", "x"])).toEqual({ error: expect.stringMatching(/INVITE_PASSWORD/) });
    expect(parseInviteArgs(["--role", "planner"])).toEqual({ error: expect.stringMatching(/--username/) });
    expect(parseInviteArgs(["--username", "a", "--email", "a@x.in"])).toEqual({ error: expect.stringMatching(/--role/) });
    expect(parseInviteArgs(["--username", "a", "--colour", "red"])).toEqual({ error: expect.stringMatching(/Unknown/) });
  });
});
