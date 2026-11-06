// Creates or updates a user. The password comes from the INVITE_PASSWORD environment variable.
// Usage: see INVITE_USAGE in lib/invite-args.ts, or run `npm run invite` with no arguments.

import { config } from "dotenv";
import { closeDb, getDb } from "@/lib/db";
import { INVITE_USAGE, parseInviteArgs } from "@/lib/invite-args";
import { setUserActive, setUserRole, upsertUser } from "@/lib/users";

config({ path: [".env.local", ".env"], quiet: true });

async function main() {
  const parsed = parseInviteArgs(process.argv.slice(2));
  if ("error" in parsed) {
    console.error(`${parsed.error}\n\n${INVITE_USAGE}`);
    process.exit(1);
  }
  const { command } = parsed;
  const db = await getDb();
  console.log(process.env.DATABASE_URL ? "Using Neon (DATABASE_URL)" : "Using local PGlite in ./.pglite");

  if (command.kind === "setActive") {
    const found = await setUserActive(db, command.username, command.active);
    console.log(found ? `${command.username} ${command.active ? "enabled" : "disabled"}.` : `No user "${command.username}".`);
    await closeDb();
    process.exit(found ? 0 : 1);
  }

  if (command.kind === "setRole") {
    const result = await setUserRole(db, command.username, command.role);
    await closeDb();
    if (!result.ok) {
      console.error(result.error);
      process.exit(1);
    }
    console.log(`${command.username}: role changed from ${result.previousRole} to ${command.role}. Password unchanged.`);
    process.exit(0);
  }

  const password = process.env.INVITE_PASSWORD ?? "";
  if (!password) {
    console.error(`Set INVITE_PASSWORD first.\n\n${INVITE_USAGE}`);
    await closeDb();
    process.exit(1);
  }
  const result = await upsertUser(db, { ...command, password });
  await closeDb();
  if (!result.ok) {
    console.error(result.error);
    process.exit(1);
  }
  console.log(
    `${result.created ? "Created" : "Updated"} ${command.username} (${command.role}). Share the password with them privately.`,
  );
}

main().catch(async (err) => {
  console.error(err);
  await closeDb().catch(() => {});
  process.exit(1);
});
