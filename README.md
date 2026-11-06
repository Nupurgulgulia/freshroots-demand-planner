# Freshroots Demand Planner

A web app that turns weekly sales and stock data into reorder recommendations for the demand planner (Raghav) and
procurement.

- **Rules engine:** Raghav's rules as plain TypeScript functions with unit tests. No LLM is involved in any number
  or decision.
- **Gemini:** writes a one-line reason per recommendation and a 2-3 sentence brief per exception, from the engine's
  numbers only, within a monthly call limit.
- **People decide:** planners approve, edit or reject each recommendation; procurement confirms unusually large
  quantities and sends approved orders to Zoho as **drafts**. Every decision and every settings change is audited
  against a named, signed-in user.
- **Runs itself:** a daily scheduled job recalculates on Mondays and Thursdays and emails a summary.

Stack: Next.js 16 (App Router, TypeScript), Auth.js v5, Neon Postgres via Drizzle ORM, Google Gemini
(`@google/genai`), Resend for email, Vitest and Playwright. Hosted on Vercel.

## Pages

| Page | Who | What it does |
| --- | --- | --- |
| `/` Dashboard | everyone | All SKUs from the latest run: stock, demand, weeks of cover, colour-coded flag, recommended action, reason and review status, with charts. **Recalculate** and **Generate AI reasons** for planners. |
| `/sku/[id]` | planner, procurement | 16-week sales chart, the numbers behind the decision, each rule and whether it fired, the Gemini text, open POs, the review form and the decision history. |
| `/review` | planner, procurement (view) | Pending recommendations (exceptions first) with Approve / Edit quantity / Reject plus a note, then the decided ones. |
| `/approved` | planner, procurement | Approved orders for the latest run by distributor. Large quantities wait for procurement to confirm; **Download CSV** and (when switched on) **Send to Zoho as draft**. |
| `/performance` | everyone | Forecast accuracy and cover once a run is 4 complete weeks old, override rate, review time, stock history, and quarterly loss figures that are **entered by hand, not measured**. |
| `/runs` Run history | planner, procurement | Every past run with its flags, decisions and units, and a comparison of any two runs: totals, threshold edits, and each SKU whose flag, action, quantity or exception status changed (with cover and demand before and after). |
| `/upload` | planner | Upload any of the CSVs. Each file is validated in full before anything is saved. |
| `/settings` | planner | Thresholds and festival calendar (every change logged), and **Automation**: the schedule, recent jobs and emails, and **Run the scheduled job now**. |
| `/zoho` | procurement | Distributor → Zoho vendor and SKU → Zoho item mapping (form or CSV). Only shown when Zoho ordering is on. |
| `/account` | everyone | Your details and password change. |

## Rules (in `lib/rules/engine.ts`)

"Now" is the latest week in the sales data. `avg12` is the mean of the last 12 weeks and `avg4` the mean of the last
4 (which sit inside the 12).

1. **Festival uplift:** if the month of `As_Of_Date` is a festival month, baseline = avg12 × 1.25; otherwise
   baseline = avg12.
2. **Weeks of cover** = (units on hand + units on open purchase orders) ÷ baseline. "On order" is ordered minus
   received, for POs with status Open, Issued or Partially Received; with no PO data it is 0.
3. **Stockout risk:** cover < 6 weeks (< 3 for High perishability). Reorder `Standard_Reorder_Qty`.
4. **Overstock risk:** cover > 14 weeks (> 4 for High perishability). Pause the next order.
5. **High demand:** avg4 > 1.2 × avg12. Reorder 1.5 × `Standard_Reorder_Qty`.
6. **Stockout risk + high demand:** reorder 1.5× and mark as an exception for human review.
7. **Otherwise:** no action.

**Exceptions** also include any SKU with fewer than 12 weeks of history or missing data, and any SKU with a
**late PO** (expected before the stock date and not fully received). A late PO is still counted in cover; it only
asks a person to check. See the assumptions below.

### Result on the provided data

The unit tests in `lib/rules/engine.test.ts` assert this, and it matches the expected result exactly:

| SKU | Result |
| --- | --- |
| SKU001 | Stockout risk + high demand → **exception, reorder 750** (cover 3.4 wks; avg4 261.0 vs avg12 214.9 = +21.4%) |
| SKU003, SKU004, SKU011, SKU013 | Stockout risk → reorder 300 / 150 / 500 / 120 |
| SKU006, SKU007 | Overstock risk → pause next order |
| The other 8 | No action |

Two results are close to a threshold. SKU001's demand jump (+21.4%) is only just over 20%: at 22% it becomes a plain
stockout with a reorder of 500 (the run-history test uses exactly this change). SKU002 is "no action" only because of
the October uplift; without it, its cover would be 14.3 weeks, which is overstock.

## Local setup

Requirements: Node.js 20+ (tested on 24) and npm.

```bash
npm install
cp .env.example .env.local      # then fill in values (all optional for local use except AUTH_SECRET)
npm run db:seed                 # load /data, insert default thresholds, create the first run
npm run invite -- --username raghav --role planner --email raghav@example.com   # password from INVITE_PASSWORD
npm run dev                     # http://localhost:3000
npm test                        # unit and database tests (Vitest)
npm run lint                    # type-check
npm run e2e                     # end-to-end tests in a real browser (Playwright), see below
```

On Windows PowerShell, use `npm.cmd` if `npm.ps1` is blocked, and put values containing `$` in single quotes.

With **no `DATABASE_URL`**, the app uses an embedded Postgres ([PGlite](https://pglite.dev)) stored in `./.pglite`,
so it runs locally with no setup. PGlite allows only one process at a time: stop `npm run dev` before running
`npm run db:seed` or `npm run invite`. Delete `./.pglite` to start from scratch; do the same if a hard-killed dev
server leaves it unopenable ("PGlite failed to initialize properly").

With **`DATABASE_URL` set**, the same code talks to Neon. Migrations (in `./drizzle`) run automatically the first
time the app or a script connects.

Optional features switch themselves off when their keys are missing: no `GEMINI_API_KEY` means template reasons
only; no `RESEND_API_KEY` means emails are logged, not sent; no Zoho keys means open POs come from CSV.
`npm run mock:zoho` starts a fake Zoho on port 4010 for trying the Zoho features locally (see `.env.example`).

## End-to-end tests

`npm run e2e` (first time: `npx playwright install chromium`) does everything itself:

1. `e2e/seed.ts` rebuilds a **separate** database in `./.pglite-e2e` from the sample CSVs, with one run and three
   test users (`e2e/users.ts`). It refuses to run against anything else.
2. It starts the app on port 3100, building into `.next-e2e`, so it can run while `npm run dev` is up. Gemini,
   Resend, Zoho and any `DATABASE_URL` are switched off for the test server, so nothing leaves the machine.
3. `e2e/app.spec.ts` checks: sign-in redirects and a wrong password; the cron route refusing calls without the
   secret; a planner approving a recommendation, recalculating and comparing the two runs; procurement and viewer
   only reaching their own pages; and no side scroll on the main pages at 320, 375 and 1440 px.

A report is written to `playwright-report/` (git-ignored).

## Environment variables

All of them are listed with comments in `.env.example`. Keys go in `.env.local` locally and in Vercel → Project →
Settings → Environment Variables in production. `.env*` files are git-ignored; never commit them. Restart
`npm run dev` (or redeploy) after changing them.

| Name | Needed | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | On Vercel | Neon Postgres connection string. Set by the Neon integration. |
| `AUTH_SECRET` | Yes | Signs the login cookies (Auth.js). `npx auth secret` makes one. |
| `INVITE_PASSWORD` | For `npm run invite` | The new user's password, read from the environment so it never appears in the command. |
| `LOGIN_HINT` | No | Text shown on the login page (e.g. demo accounts for reviewers). Remove it to hide the box. |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | For AI text | Gemini key and model (default `gemini-3.8-flash`). |
| `AI_MONTHLY_CALL_CAP` | No | Gemini calls allowed per month (default 500). |
| `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_ORG_ID`, `ZOHO_DC` | No | Zoho Inventory API access (data centre default `in`). |
| `ZOHO_ORDERING_ENABLED` | No | `1` lets procurement create **draft** POs in Zoho. Off otherwise. |
| `CRON_SECRET` | On Vercel | Vercel Cron sends it as a Bearer token; the job refuses any call without it. |
| `RESEND_API_KEY`, `EMAIL_FROM` | For email | Resend key and sender (default `onboarding@resend.dev`, which only delivers to the Resend account's own address until a domain is verified). |
| `APP_URL` | No | Link used in emails (defaults to the Vercel production URL). |
| `STALE_SALES_WEEKS`, `STALE_STOCK_DAYS` | No | When the scheduled run counts data as too old (defaults 1 week, 10 days). |
| `PGLITE_DIR` | No | Where local PGlite data lives (default `./.pglite`). |

## Sign-in and roles

Each person has their own account (Auth.js credentials, passwords hashed with scrypt). There is no sign-up page:
accounts are created with `npm run invite`, which can also `--reset` a password, change a role (`--role-only`),
`--disable`/`--enable` an account, or `--check` a password without changing anything. Five wrong passwords lock an
account for 15 minutes (stored in the database, so it holds across servers).

| Role | Can |
| --- | --- |
| **planner** | Everything about the plan: review, upload, recalculate, AI text, thresholds, quarterly figures, run history, approved orders and export. |
| **procurement** | See the plan, review page, approved orders and run history; export; confirm large quantities; send drafts to Zoho; manage the Zoho mapping. |
| **viewer** | Dashboard and Performance only. |

`proxy.ts` (Next.js 16's middleware) sends signed-out visitors to `/login` and keeps each role on its pages, and every
page and server action checks the user again against the database (`lib/session.ts`), so a disabled account or
changed role takes effect at once. The rules are one table in `lib/permissions.ts`.

## Safety guardrails

- **Quantity cap:** an approved quantity above 3× the standard reorder quantity (a setting) is held until
  procurement confirms it; it is left out of the CSV and Zoho until then.
- **Late POs** make an exception without changing the cover maths.
- **AI cap:** at most `AI_MONTHLY_CALL_CAP` Gemini calls a month (India time), counted atomically in the database.
- **Zoho drafts only:** the app never issues a PO. One draft per distributor per run, with a stable reference
  (`FR-R<run>-<distributor>`), so a retry can't create a duplicate; a send with no answer is marked "unknown" until
  someone checks Zoho.

## Scheduled job and emails

`vercel.json` runs `/api/cron/daily` once a day at 00:30 UTC (06:00 India time). Vercel's Hobby plan allows one
run a day and may fire up to an hour late, so the job itself decides:

- **Every day:** remind planners about reviews pending more than 2 days (at most once a day).
- **Mondays and Thursdays:** sync open POs from Zoho (if connected); check freshness; if sales or stock are too old,
  **skip** and email planners and viewers to upload fresh files; otherwise recalculate, write AI text within the
  cap, and email planners a run summary. It never recalculates twice in one day.

Every job and email is recorded and shown in Settings → Automation, where planners can also run the job by hand
(that ignores the weekday rule but still checks freshness).

## Open purchase orders and Zoho

Stock already ordered counts towards cover, so it isn't ordered again. Open POs are a snapshot replaced each time
they are loaded, from either:

- **CSV:** `open_purchase_orders.csv` with `PO_Number, SKU_ID, Ordered_Qty, Received_Qty, Expected_Date, Status`
  (an example is in `data/samples/`), or
- **Zoho Inventory:** **Sync from Zoho** on the Upload page (and in the scheduled job). Zoho item SKUs are matched
  to `SKU_ID`.

To connect Zoho: add a **Self Client** in the Zoho API console for your data centre (India:
https://api-console.zoho.in), generate a grant code with scopes `ZohoInventory.purchaseorders.READ` (plus
`purchaseorders.CREATE`, `items.READ` and `contacts.READ` for drafts), exchange it for a refresh token, and set the
`ZOHO_*` variables. The API calls follow Zoho Inventory's v1 docs and were tested against the local mock only; check
the first live sync and the first draft against Zoho. Each distributor is assumed to be one Zoho **vendor**.

## How Gemini is kept away from the numbers

- `lib/ai/facts.ts` builds the only payload Gemini sees: engine-computed numbers, rule names, the decided action
  and quantity, and the thresholds. SKU names are left out because they contain numbers such as "500ml".
- `lib/ai/gemini.ts` asks for structured JSON (`{reason, brief}`) with instructions never to calculate anything.
- Every number in the reply is checked against the numbers sent (allowing only rounding); any other number and the
  text is discarded. Tests: `lib/ai/facts.test.ts`.
- The action and quantity shown always come from the engine, never from Gemini.

## Data model (`lib/db/schema.ts`)

- **Source data:** `skus`, `distributors`, `weekly_sales`, `inventory` (+ `inventory_snapshots`, every upload kept),
  `festival_calendar`, `open_purchase_orders`, `uploads`
- **People:** `users`, `login_attempts`
- **Configuration:** `settings` and `settings_log`; `quarterly_figures`
- **Output:** `runs` (one per recalculation, with a snapshot of the thresholds) and `recommendations` (one per SKU
  per run, with the full evaluation and the latest review state)
- **Audit and integrations:** `review_audit`, `ai_explanations`, `ai_usage`, `zoho_vendor_map`, `zoho_item_map`,
  `zoho_po_sends`, `job_runs`, `email_log`

To change the schema, edit `lib/db/schema.ts`, run `npx drizzle-kit generate --name <change>`, and commit the new
file in `./drizzle`. Migrations run on the next connection.

## Deploying on Vercel

1. Import the GitHub repo in Vercel (Next.js preset, default build settings). Every push to `main` deploys.
2. Install the **Neon** integration from the Vercel Marketplace; it sets `DATABASE_URL`. (The PGlite fallback needs
   a writable disk, which serverless functions don't have.)
3. Set `AUTH_SECRET`, `CRON_SECRET`, and any optional keys above, then deploy. Migrations run on the first request.
4. Create the first accounts: put the Neon `DATABASE_URL` in `.env.local` and run `npm run invite`.
5. Load data with `npm run db:seed` (same `DATABASE_URL`) or the Upload page.

## Backups: Neon point-in-time restore

Neon keeps a history of every change, so the database can be put back to any moment inside the project's **restore
window** (set per plan; the free plan keeps only a short window, paid plans longer). Check yours in the Neon console
under the project's settings before relying on it. Open the project from Vercel → Storage → the Neon store →
**Open in Neon**.

To recover from a bad upload or a mistaken bulk change:

1. In Neon, go to **Backup & Restore** (instant restore / point-in-time restore) for the production branch.
2. Prefer restoring **to a new branch** at a time just before the problem, and check the data there first (for
   example by pointing a local `.env.local` `DATABASE_URL` at that branch and running the app).
3. When it's right, restore the main branch to that time (Neon keeps a backup branch of the state it replaced), or
   copy the needed rows across. The app needs no change: it keeps using the same `DATABASE_URL`.

Restoring rolls back **everything** after that moment, including reviews, logins and job history, so note what was
done since then. Uploaded CSVs are also kept in the `uploads` table, and every review and settings change is in the
audit tables, which helps rebuild anything lost.

## Assumptions

These are my readings of the brief. Each is easy to change.

1. **"Now" and the festival month.** "Now" is the latest ISO week in the sales data (2026-W42). The festival check
   uses the month of each SKU's `As_Of_Date` (2026-10, a festival month), not the month of "now".
2. **Strict comparisons.** Stockout means cover < threshold; overstock means cover > threshold; high demand means
   avg4 > 1.2 × avg12. A value exactly on a threshold does not fire.
3. **Quantities.** 1.5 × standard is rounded **up** to whole units (e.g. 75 → 113).
4. **Overstock + high demand** conflict, so the engine pauses the next order and marks the SKU as an exception.
5. **Missing data makes an exception with no automatic recommendation** ("Planner review"): fewer than 12 weeks of
   history, a missing week in the window, no inventory record, zero sales, missing perishability or reorder
   quantity, or no calendar entry for the stock month.
6. **Distributor checks.** A distributor that is not `Active`, or not in the master, makes the SKU an exception but
   keeps its recommendation.
7. **Several stock locations** for one SKU are added together; the latest `As_Of_Date` is used.
8. **Runs are snapshots.** Recalculating creates a new run and leaves earlier runs and their reviews untouched.
   Threshold and calendar edits apply from the next run. Dashboard, review and approved pages show the latest run;
   Run history shows the rest.
9. **Reviews.** Approve keeps the engine quantity. Edit needs a whole number and a note; Reject needs a note. A
   decision can be changed later, each change a new audit row. The reviewer is the signed-in user.
10. **Uploads.** Master data, sales and calendar rows are upserted by key; `current_inventory` and
    `open_purchase_orders` replace the whole snapshot. A file with any invalid row is rejected entirely.
    `Unit_Price` in `sku_master.csv` is optional and kept when a later file leaves it out.
11. **Outcomes** are measured only once 4 complete weeks of sales exist after a run. Rupee figures are units ×
    `Unit_Price`; the app claims no savings of its own.
12. **Not built (by decision):** scheduled SAP import, per-distributor forecasts, WhatsApp alerts, backtesting on
    past decisions.

## Project layout

```
app/                 Pages, server actions (app/actions.ts), API routes (auth, cron, CSV export)
components/          Client components (forms, charts, badges, sidebar)
lib/rules/           Rules engine, ISO-week helpers, input builder (pure, unit-tested)
lib/data/            CSV parsing/validation and DB loader
lib/ai/              Gemini facts, number guard, client, cache and monthly cap
lib/zoho/            Zoho API client, PO sync, draft ordering, mock server
lib/automation/      Scheduled job, freshness rules, email
lib/db/              Drizzle schema and client (Neon or PGlite)
lib/run-history.ts   Run summaries and two-run comparison
lib/permissions.ts   Roles and what each can do
scripts/             seed, invite, mock Zoho
e2e/                 Playwright tests and their seed
data/                The sample CSVs (data/samples: extra examples, local use only)
drizzle/             SQL migrations
```
