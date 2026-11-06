// Argument parsing for `npm run invite`. Pure, so it's unit-tested.

export type InviteCommand =
  | { kind: "upsert"; username: string; role: string; email: string; reset: boolean }
  | { kind: "setActive"; username: string; active: boolean }
  | { kind: "setRole"; username: string; role: string };

export const INVITE_USAGE = `Usage:
  INVITE_PASSWORD='…' npm run invite -- --username raghav --role planner --email raghav@example.com
  INVITE_PASSWORD='…' npm run invite -- --username raghav --role planner --email raghav@example.com --reset
  npm run invite -- --username raghav --role procurement --role-only   (change role, keep password)
  npm run invite -- --username raghav --disable      (or --enable)

Roles: planner, procurement, viewer. The password is read from the INVITE_PASSWORD environment
variable, never from the command line, and only its hash is stored.`;

export function parseInviteArgs(argv: string[]): { command: InviteCommand } | { error: string } {
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) return { error: `Unexpected argument "${a}".` };
    const key = a.slice(2);
    if (key === "password") return { error: "Don't pass the password on the command line; set INVITE_PASSWORD instead." };
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags.set(key, next);
      i++;
    } else flags.set(key, true);
  }
  const known = new Set(["username", "role", "email", "reset", "disable", "enable", "role-only"]);
  for (const k of flags.keys()) if (!known.has(k)) return { error: `Unknown option --${k}.` };

  const value = (k: string) => (typeof flags.get(k) === "string" ? (flags.get(k) as string) : "");
  const username = value("username");
  if (!username) return { error: "--username is required." };

  if (flags.has("disable") || flags.has("enable")) {
    if (flags.has("disable") && flags.has("enable")) return { error: "Use either --disable or --enable, not both." };
    return { command: { kind: "setActive", username, active: flags.has("enable") } };
  }
  const role = value("role");
  const email = value("email");
  if (!role) return { error: "--role is required (planner, procurement or viewer)." };
  if (flags.has("role-only")) {
    if (flags.has("reset") || email) return { error: "--role-only changes just the role; leave out --email and --reset." };
    return { command: { kind: "setRole", username, role } };
  }
  if (!email) return { error: "--email is required." };
  return { command: { kind: "upsert", username, role, email, reset: flags.has("reset") } };
}
