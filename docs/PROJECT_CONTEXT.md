# Freshroots Demand Planner: full project context

> Paste this into a new Claude chat to bring it up to speed. It describes what has been built, how it works,
> the decisions already made, and what is left. No passwords or API keys are included. As of 6 Nov 2026,
> latest commit `d6fc8b8`.

---

## 1. What it is

A web app for **Freshroots** (packaged food and beverage, India) that turns weekly sales and stock data into
**reorder recommendations**. The users are the **demand planner (Raghav)** and **procurement**.

- A **rules engine** (plain TypeScript, unit-tested) decides every number and action. No AI is involved in any
  decision.
- **Google Gemini** only writes a one-line reason per recommendation and a short brief for exceptions, using
  the engine's numbers. A guard rejects any AI text that contains a number the engine didn't supply.
- **People decide.** Each recommendation is approved, edited (quantity) or rejected, with a note and a typed
  name, and every decision is audited. Approved orders export to CSV for procurement.

## 2. Links and accounts

| Thing | Value |
|---|---|
| Live site | https://freshroots-demand-planner-cyan.vercel.app (behind a shared password) |
| GitHub repo | https://github.com/Nupurgulgulia/freshroots-demand-planner (branch `main`; every push to main auto-deploys) |
| Vercel | Team "Mesa" (`mesa-8ce2`), project `freshroots-demand-planner`, region iad1, Node 24 |
| Database | Neon Postgres, attached through the Vercel integration (it injected `DATABASE_URL`) |
| Local folder | `C:\Users\Nupur Gulgulia\Desktop\freshroots` (Windows) |
| Local dev | `npm run dev` → http://localhost:3000, using embedded PGlite in `./.pglite` when `DATABASE_URL` is unset |

## 3. Tech stack

- **Next.js 16.4** (App Router, TypeScript, Turbopack) with React 19 server actions and `useActionState`.
  - In Next 16, middleware is `proxy.ts`. The repo's `AGENTS.md` warns that this Next version differs from
    older docs; check `node_modules/next/dist/docs/`.
- **Drizzle ORM 0.45:**
  - `drizzle-orm/neon-serverless` (Pool) when `DATABASE_URL` is set; otherwise **PGlite** (`@electric-sql/pglite`).
  - Migrations in `./drizzle` run automatically on first `getDb()`.
  - On Neon, migrations run under a Postgres **advisory lock**, which fixed a cold-start race.
- **Gemini** via `@google/genai`, with structured JSON output (`responseJsonSchema`).
  - Default model `gemini-3.8-flash`; `gemini-2.5-flash` isn't available to new API users.
- **Other libraries:** zod 4 (validation), papaparse (CSV), recharts 3 (charts), vitest (tests), tsx (seed
  script), TypeScript 5.9.
- **Fonts and icons:** Inter via `next/font/google`, and a small set of inline SVG icons (no icon library).

**Scripts:**
- `npm run dev`
- `npm run build`
- `npm test` (vitest)
- `npm run lint` (`tsc --noEmit`)
- `npm run db:seed` (loads `/data`, inserts default thresholds, runs the engine)

**Windows and sandbox gotchas:**
- **Install scripts:** `npm install` fails to spawn cmd.exe for install scripts, so use `npm install --ignore-scripts`.
- **drizzle-kit and long paths:** `package.json` has `"overrides": { "esbuild": "^0.28.2" }` so drizzle-kit works
  in deep folder paths.
- **PGlite is single-process:** stop the dev server before `npm run db:seed`.
  - A hard kill can corrupt `./.pglite` ("PGlite failed to initialize"). If that happens, rename or delete the
    folder and reseed.
  - Stopping the shell task may leave the `node` process holding port 3000; kill it by PID.
- **`.env.local` loading:** Next loads `.env.local` at startup. The preview launcher in the Claude desktop app hid
  `.env` files from the server, so run `npm run dev` from a terminal instead.
- **Migrations:** to change the schema, edit `lib/db/schema.ts`, run `npx drizzle-kit generate --name <change>`,
  and commit the new SQL.

## 4. Input data (5 required CSVs + 1 optional)

Each file is validated in full; if any row fails, nothing from that file is saved. Master data, sales and the
calendar are upserted by key. Inventory and open POs are snapshots that replace the whole table.

| File | Columns | Key |
|---|---|---|
| `weekly_sales.csv` | `SKU_ID, Week (ISO, e.g. 2026-W42), Units_Sold` | SKU_ID + Week |
| `sku_master.csv` | `SKU_ID, SKU_Name, Category, Perishability (Low/High), Standard_Reorder_Qty, Unit_of_Measure, Distributor_ID` | SKU_ID |
| `distributor_master.csv` | `Distributor_ID, Distributor_Name, Region, Status` | Distributor_ID |
| `current_inventory.csv` | `SKU_ID, Location, Units_On_Hand, As_Of_Date (YYYY-MM-DD)` | SKU_ID + Location |
| `calendar.csv` | `Year, Month, Year_Month (YYYY-MM), Is_Festival_Month (TRUE/FALSE)` | Year_Month |
| `open_purchase_orders.csv` (optional) | `PO_Number, SKU_ID, Ordered_Qty, Received_Qty (blank = 0), Expected_Date (blank ok), Status` | PO_Number + SKU_ID |

- The provided sample data (in `/data`) has 15 SKUs (SKU001–SKU015), 4 active distributors, and sales up to
  **2026-W42**. Stock is dated **2026-10-19**, and **October 2026 is a festival month**.
- An example open-PO file is in `data/samples/open_purchase_orders.example.csv`; it isn't auto-loaded.

## 5. The rules (`lib/rules/engine.ts`, pure functions)

"Now" is the latest ISO week in the sales data. `avg12` is the mean of the last 12 weeks and `avg4` the mean of
the last 4.

1. **Festival uplift:** if the month of `As_Of_Date` is a festival month, baseline = avg12 × 1.25; otherwise
   baseline = avg12.
2. **Weeks of cover** = (units on hand + units on order) ÷ baseline.
   - "On order" = ordered − received for POs with status Open, Issued or Partially Received.
   - With no PO data, "on order" is 0.
3. **Stockout risk:** cover < 6 weeks (< 3 for High perishability). Action: reorder `Standard_Reorder_Qty`.
4. **Overstock risk:** cover > 14 weeks (> 4 for High perishability). Action: pause the next order.
5. **High demand:** avg4 > 1.2 × avg12. Action: reorder 1.5 × standard, rounded **up** to whole units.
6. **Stockout + high demand:** reorder 1.5× and mark as an **exception** for human review.
7. Otherwise: no action.

**Exceptions** also cover missing or bad data. In these cases the action is "Planner review" and there is no
quantity:
- fewer than 12 weeks of history
- a gap in the 12-week window
- no inventory record
- zero sales
- missing perishability or reorder quantity
- no calendar entry

**Other review cases** mark an exception but keep the recommendation:
- the distributor is inactive or unknown
- overstock and high demand both apply

**Thresholds are editable and stored in the database** (Settings page, every change logged). Defaults:
- `stockoutWeeks` 6, `overstockWeeks` 14
- `stockoutWeeksPerishable` 3, `overstockWeeksPerishable` 4
- `highDemandPct` 0.2, `highDemandMultiplier` 1.5, `festivalUpliftPct` 0.25

All comparisons are strict, so a value exactly on a threshold doesn't fire.

### Expected result on the provided data (asserted by unit tests; matches the spec exactly)

| SKU | Result |
|---|---|
| SKU001 | Stockout + high demand → **exception, reorder 750** (cover 3.4 wks; avg4 261.0 vs avg12 214.9 = +21.4%) |
| SKU003 / 004 / 011 / 013 | Stockout risk → reorder 300 / 150 / 500 / 120 |
| SKU006 / SKU007 | Overstock risk → pause next order |
| The other 8 | No action |

Totals: 1,820 units to order, 7 recommendations to review.

**Close calls:**
- SKU001's +21.4% is barely over 20%.
- SKU002 is "no action" only because of the festival uplift; without it, cover would be 14.3 weeks.

## 6. Data model (`lib/db/schema.ts`)

- **Source data:** `distributors`, `skus`, `weekly_sales`, `inventory`, `festival_calendar`,
  `open_purchase_orders` (with `source` = csv | zoho and `loaded_at`), and `uploads` (upload/sync log).
- **Configuration:** `settings` (thresholds) and `settings_log` (who, when, old → new value, note).
- **Output:**
  - `runs`: one per recalculation, with a snapshot of the thresholds used.
  - `recommendations`: one per SKU per run. Holds the flag, action and quantity, the full engine evaluation as
    JSON, and the review state (PENDING / APPROVED / EDITED / REJECTED / NO_ACTION, final quantity, reviewer,
    note).
- **Audit and AI:**
  - `review_audit`: every decision, as a new row.
  - `ai_explanations`: cached Gemini text keyed by a hash of the facts plus the model.
- **Migrations:** `0000_init`, `0001_open_purchase_orders`.

Runs are snapshots: recalculating creates a new run and leaves old runs and their reviews untouched. The pages
always show the latest run.

## 7. How Gemini is kept away from the numbers (`lib/ai/`)

- **`facts.ts`** builds the only payload Gemini sees: engine numbers rounded to 1 decimal, rule names, the
  decided action and quantity, the thresholds, and units on order.
  - SKU names are excluded because they contain numbers like "500ml".
- **`gemini.ts`** asks for JSON `{reason, brief}` with instructions never to calculate or change anything.
- **Number guard:** every number in the reply must match a supplied number (rounding to 0–2 decimals is allowed).
  Otherwise the text is discarded and the error is shown on the SKU page.
- **Caching:** results are cached. "Generate AI reasons" fills them in for a whole run (3 at a time), and
  "Regenerate" forces a fresh call for one SKU. "No action" SKUs aren't sent to Gemini.

## 8. Pages and UX (redesigned and live)

**Look:**
- Inter font, a deep green brand colour with a leaf logo, soft cards, coloured status pills, and automatic dark
  mode.
- A left sidebar with icons and a red pending-review count.
- On phones the sidebar becomes a compact top bar (logo and icons only).
- **There must be no horizontal scrolling anywhere.** The user explicitly disliked side scroll.

| Page | What it shows |
|---|---|
| `/` Dashboard | Header: week, run, festival tag; Recalculate and Generate AI reasons buttons. **5 KPI cards** (awaiting review, exceptions, stockout, overstock, units to order). **Charts:** total sales over 16 weeks (area chart, festival weeks shaded, 12-wk average line, trend badge) and a status-mix donut. **Stock health by SKU** panel: one row per SKU with a 12-week sparkline, a demand-change pill (4 wk vs 12 wk; blue when past +20%) and a weeks-of-cover gauge drawn against that SKU's own limits (red/green/amber zones, perishables marked "P"), sorted by risk. **Filter bar** (segmented control): Needs action (default) \| Exception · Stockout · Overstock · (High demand when present) \| No action · All SKUs, with "Showing X of Y SKUs". **Table** with fixed column widths that always fits: the Why column hides at ≤1280px, and at ≤1024px each row becomes a card. Shows "+N on order" under on-hand. |
| `/sku/[id]` | Header card with the decision; stat tiles (on hand, **on order**, 12-wk, 4-wk, baseline, cover); an open-PO table; a 16-week sales chart; a rule checklist and exception callout; the AI explanation with Regenerate; Approve / Edit / Reject; decision history. |
| `/review` | "Reviewing as" name bar (entered once, saved in the browser). One card per pending recommendation, exceptions first with a purple edge. Buttons: **Approve N**, **Edit** (quantity + required note) and **Reject** (required note). A table of decided items. |
| `/approved` | Totals, then orders grouped by distributor with subtotals; **Download CSV**. Nothing is sent to Zoho yet. |
| `/upload` | Drag-and-drop CSV upload with optional recalculation. **Open purchase orders** section: count, units on order, last loaded and source, plus a **Sync from Zoho** button (disabled until Zoho is configured). Lists the expected columns and recent uploads. |
| `/settings` | Thresholds form, festival calendar, change log. |
| `/login` | Centred "Welcome back" card with no sidebar. |

Cover values show 2 decimals when 1 decimal would land exactly on a limit (2.98 instead of "3.0").

## 9. Access control (temporary)

- **The gate:** the whole site sits behind one shared password (`APP_PASSWORD`).
  - `proxy.ts` redirects page loads without a valid cookie to `/login?next=…`, and returns 401 to form posts
    and the CSV export.
  - The cookie `fr_session` is an HMAC-SHA256 of the password, lasts 30 days and is httpOnly, so changing the
    password signs everyone out.
- **Where it's set:** the password lives in `.env.local` and in Vercel's environment variables. The user changed
  it; the current password is not included here.
- **Limits:** reviewer names are typed by hand, so the audit log records who people *say* they are. This should
  be replaced with real sign-in before go-live.

## 10. Open purchase orders and Zoho Inventory (latest feature)

The user's choices:
- Zoho **Inventory**, not Books.
- **Count all not-yet-received units** in cover, whatever the expected date.
- Zoho item **SKU = our SKU_ID**.
- **No Zoho API access yet**, so build with a CSV for now.

**How it's built:**
- **Two ways to load POs, both replacing the snapshot:** upload `open_purchase_orders.csv`, or press **Sync from
  Zoho**.
- **The Zoho client** (`lib/zoho/inventory.ts`):
  - Gets an OAuth refresh-token access token from `accounts.zoho.{dc}`.
  - Lists `GET https://www.zohoapis.{dc}/inventory/v1/purchaseorders` (paged, 200 per page), keeps the open
    ones, then fetches each PO's line items.
- **The parser** (`lib/zoho/purchase-orders.ts`, tested) reads:
  - `purchaseorder_number`, `status`, `received_status`, `delivery_date`
  - `line_items[].sku`, `quantity`, `quantity_received`, `quantity_cancelled`
- **Status:** this mapping has **not yet been run against a live Zoho organisation**, so check the first sync
  against Zoho.
- **Env vars:** `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_ORG_ID`, `ZOHO_DC`
  (default `in`). Scope: `ZohoInventory.purchaseorders.READ`. The setup steps are in the README.
- **Live site:** the table exists on Neon but no POs are loaded yet, so live results are unchanged.

## 11. Environment variables (names only)

| Name | Where | Purpose |
|---|---|---|
| `DATABASE_URL` | Vercel (set by the Neon integration) | Neon connection; unset locally = PGlite |
| `GEMINI_API_KEY` | `.env.local` + Vercel | Gemini explanations (the app works without it; buttons are disabled) |
| `GEMINI_MODEL` | `.env.local` + Vercel | `gemini-3.8-flash` |
| `APP_PASSWORD` | `.env.local` + Vercel | Shared site password |
| `ZOHO_*` | not set yet | Zoho Inventory sync |
| `PGLITE_DIR` | optional | Local PGlite folder |

`.env*` files are git-ignored; `.env.example` is the template.

## 12. Code map

```
app/                 pages, server actions (app/actions.ts), CSV export route, login
components/          Sidebar, forms (client), badges + CoverBar, DashboardCharts (recharts),
                     StockHealth (server, sparklines and gauges), SalesChart, icons
lib/rules/           engine.ts, inputs.ts (joins source data, sums open POs), weeks.ts (ISO weeks); all pure + tested
lib/data/            csv.ts (zod schemas, parsing), load.ts (DB writes, snapshot replace)
lib/ai/              facts.ts (payload + number guard), gemini.ts, explain.ts (cache, batch)
lib/zoho/            inventory.ts (API client), purchase-orders.ts (parser, tested)
lib/db/              schema.ts, index.ts (Neon or PGlite, auto-migrate, advisory lock)
lib/                 auth.ts, review.ts, settings*.ts, run-engine.ts, format.ts
proxy.ts             password gate
scripts/seed.ts      loads /data and runs the engine
drizzle/             SQL migrations
data/                the sample CSVs (+ samples/ example open POs)
```

Tests: **62 passing** (engine, weeks, CSV, AI facts and number guard, auth, Zoho parser).

## 13. Commit history

1. `54d00e4`: initial app (rules engine, Neon/Drizzle, Gemini explanations, review UI)
2. `eba43c3`: default to gemini-3.8-flash; document local env and PGlite gotchas
3. `111e4b6`: serialize Neon migrations with an advisory lock
4. `a60c9f6`: shared password gate
5. `b698db2`: UI redesign (sidebar, dashboard analytics, faster review, no side scroll)
6. `d6fc8b8`: open purchase orders count in cover; Zoho Inventory sync

## 14. Assumptions already made (each is easy to change)

1. The festival check uses the month of each SKU's `As_Of_Date`.
2. Comparisons are strict.
3. 1.5× quantities round up.
4. Overstock + high demand → pause and mark as an exception.
5. Missing data → exception with no automatic recommendation.
6. An inactive or unknown distributor → exception that keeps its recommendation.
7. Stock across several locations is summed.
8. Runs are snapshots.
9. Approve keeps the engine quantity; Edit needs a quantity and a note; Reject needs a note; decisions can be
   changed and every change is audited; approving a "pause" creates no order line.
10. Uploads are all-or-nothing per file.
11. AI text is generated on demand, not on every run.
12. Open POs count in full regardless of expected date, so a late PO can hide a stockout.

## 15. What is left to build (priority order)

1. **Real sign-in per person** (Auth.js with Google or email link). Roles: planners approve, procurement
   views and exports. The reviewer name would come from the login. The current shared password is weak.
2. **Connect Zoho for real:** get API credentials, set the `ZOHO_*` vars, and verify the first sync.
3. **Send approved orders to Zoho** as POs (today procurement downloads a CSV).
4. **Automatic weekly run** with Vercel Cron.
5. **Scheduled SAP data import** instead of manual CSV uploads.
6. **Email or WhatsApp alerts** for exceptions, stockouts and overdue reviews.
7. **Per-distributor forecasts.**
8. **Run history and comparison** across weeks.
9. **End-to-end browser tests** for the approve, upload and export flows.
10. **Monitoring, Neon backups / point-in-time restore, and login rate limiting.**
11. **README refresh** for the new UI. The README already covers the rules and the Zoho setup, but not the new
    screens.

## 16. How the user likes to work

- **Plan first and work in small steps.** Show changes **locally** and **ask for approval before committing or
  deploying**; the user then says "Approved, deploy it".
- **Explain in plain language** for a non-developer; avoid jargon.
- **Ask about decisions with options when they're business choices,** as with the open-PO rules.
- **Never put secrets in chat or in git.** The user sets keys and passwords in `.env.local` and Vercel.
- **Report honestly,** including what wasn't tested (for example the Zoho mapping against a real account).
- **UI preferences:** premium and analytical, with no side scrolling, filters ordered by urgency, and charts
  that are easy to read. The user rejected plain horizontal bar charts in favour of the stock-health panel.
