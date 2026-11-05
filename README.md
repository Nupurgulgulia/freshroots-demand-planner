# Freshroots Demand Planner

A small web app that turns weekly sales and stock data into reorder recommendations for the demand planner
(Raghav) and procurement.

- **Rules engine:** Raghav's rules as plain TypeScript functions with unit tests. No LLM is involved in any number
  or decision.
- **Gemini:** writes a one-line reason per recommendation and a 2-3 sentence brief per exception, from the engine's
  numbers only.
- **People decide:** approve, edit or reject each recommendation. Every decision and every settings change is
  audited.

Stack: Next.js 16 (App Router, TypeScript), Neon Postgres via Drizzle ORM, Google Gemini (`@google/genai`), Vitest.

## Pages

| Page | What it does |
| --- | --- |
| `/` Dashboard | All SKUs from the latest run: name, perishability, stock, avg weekly demand, weeks of cover, colour-coded flag, recommended action and quantity, one-line reason, review status. Filter by flag. **Recalculate** creates a new run; **Generate AI reasons** fills in the Gemini text. |
| `/sku/[id]` | 16-week sales chart (the 12-week window is darker, with the 12-week average and festival baseline lines), the numbers behind the decision, each rule and whether it fired, the Gemini reason and brief with **Regenerate**, the review form and the decision history. |
| `/review` | Pending recommendations (exceptions first) with Approve / Edit quantity / Reject plus a note, then the decided ones. |
| `/approved` | Approved and edited reorders for the latest run, grouped by distributor, with **Download CSV**. Nothing is sent to Zoho yet. |
| `/upload` | Upload one or more of the five CSVs. Each file is validated in full before anything is saved. You can recalculate straight after. |
| `/settings` | Edit the thresholds (6, 14, 3 and 4 weeks, 20%, 1.5×, 25%) and the festival calendar. Every change is logged with who, when, old and new values, and a note. |

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

**Exceptions** also include any SKU with fewer than 12 weeks of history or missing data. See the assumptions below.

### Result on the provided data

The unit tests in `lib/rules/engine.test.ts` assert this, and it matches the expected result exactly:

| SKU | Result |
| --- | --- |
| SKU001 | Stockout risk + high demand → **exception, reorder 750** (cover 3.4 wks; avg4 261.0 vs avg12 214.9 = +21.4%) |
| SKU003, SKU004, SKU011, SKU013 | Stockout risk → reorder 300 / 150 / 500 / 120 |
| SKU006, SKU007 | Overstock risk → pause next order |
| The other 8 | No action |

Two results are close to a threshold. SKU001's demand jump (+21.4%) is only just over 20%: at 22% it becomes a plain
stockout with a reorder of 500. SKU002 is "no action" only because of the October uplift; without it, its cover
would be 14.3 weeks, which is overstock.

## Local setup

Requirements: Node.js 20+ (tested on 24) and npm.

```bash
npm install
cp .env.example .env.local      # then fill in values (all optional for local use)
npm run db:seed                 # load /data, insert default thresholds, create the first run
npm run dev                     # http://localhost:3000
npm test                        # unit tests
```

With **no `DATABASE_URL`**, the app uses an embedded Postgres ([PGlite](https://pglite.dev)) stored in `./.pglite`,
so you can run it locally with no setup. PGlite allows only one process at a time, so stop `npm run dev` before
running `npm run db:seed`, or load the data through the Upload page instead. Delete `./.pglite` to start from scratch.
If the dev server is killed hard (not stopped with Ctrl+C), PGlite can be left unopenable and pages fail with
"PGlite failed to initialize properly". If that happens, delete or rename `./.pglite` and run `npm run db:seed`
again. This affects only the local fallback, not Neon.

With **`DATABASE_URL` set**, the same code talks to Neon. Database migrations (in `./drizzle`) run automatically
the first time the app or the seed script connects.

Without `GEMINI_API_KEY`, everything works except the AI text: the buttons are disabled and the engine's template
reason is shown instead.

> Windows note: if `npm install` fails while running install scripts (`spawn cmd.exe ENOENT`), use
> `npm install --ignore-scripts`. Nothing here needs install scripts. `package.json` pins a single top-level
> `esbuild` through `overrides`, so `drizzle-kit` works in deep folder paths.

## Environment variables

| Name | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | On Vercel, yes. Locally, no | Neon Postgres connection string (pooled or direct). |
| `GEMINI_API_KEY` | For AI text | Google AI Studio / Gemini API key. |
| `GEMINI_MODEL` | No | Model name. Defaults to `gemini-3.8-flash` (`gemini-2.5-flash` is no longer offered to new API users). Check the current model list in Google's docs and set this explicitly. |
| `APP_PASSWORD` | On Vercel, yes | Shared password for the whole site. Every page, form submission and the CSV export require it. Changing it signs everyone out. If it is empty, the site is open, which is fine for local use only. |
| `PGLITE_DIR` | No | Where the local PGlite data lives (default `./.pglite`). |
| `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_ORG_ID` | No | Zoho Inventory API access for the **Sync from Zoho** button (see below). |
| `ZOHO_DC` | No | Zoho data centre domain: `in` (default), `com`, `eu`, `com.au`, … |

Next.js loads `.env.local` at startup. The startup log shows `- Environments: .env.local` when it does. Restart
`npm run dev` after editing the file. Keys belong in `.env.local` locally and in Vercel project settings in production. `.env*` files are git-ignored;
never commit them.

## Deploying on Vercel

1. Push this repo to GitHub and import it in Vercel. The framework preset is Next.js, and the default build
   settings work.
2. Add Neon: either install the **Neon** integration from the Vercel Marketplace (it sets `DATABASE_URL`
   automatically), or create a Neon project yourself and add its connection string as `DATABASE_URL`.
   **`DATABASE_URL` must be set on Vercel**: the PGlite fallback needs a writable disk, which serverless functions
   don't have.
3. Add `APP_PASSWORD`, `GEMINI_API_KEY` (and optionally `GEMINI_MODEL`) under Project → Settings → Environment Variables.
4. Deploy. Migrations run on the first request.
5. Load the data, either:
   - locally: put the Neon `DATABASE_URL` in `.env.local` and run `npm run db:seed`, or
   - in the app: open `/upload`, upload the five CSVs, and tick "Recalculate after loading".

The migration SQL ships with the functions through `outputFileTracingIncludes` in `next.config.ts`.

To change the schema, edit `lib/db/schema.ts`, run `npx drizzle-kit generate --name <change>`, and commit the new
file in `./drizzle`.

## Access control (temporary)

Until real sign-in exists, the whole site sits behind one shared password (`APP_PASSWORD`). `proxy.ts` (Next.js
16's name for middleware) redirects anyone without a valid session cookie to `/login`, and returns 401 to form
submissions and the CSV export. The cookie is an HMAC of the password, lasts 30 days, and is httpOnly. **Sign out**
clears it. The reviewer name is still typed by hand, so the audit log records who people *say* they are. Replace
this with Auth.js (Google or email link) before go-live.

## Open purchase orders (Zoho Inventory)

Stock that is already ordered counts towards weeks of cover, so the app doesn't recommend ordering it again.
Open POs are a snapshot that is replaced each time it's loaded, in one of two ways (both on the Upload page):

- **CSV:** upload `open_purchase_orders.csv` with columns
  `PO_Number, SKU_ID, Ordered_Qty, Received_Qty, Expected_Date, Status` (one row per PO line;
  `Received_Qty` and `Expected_Date` may be blank). Only Open, Issued and Partially Received lines count.
  An example is in `data/samples/`. The seed script loads `data/open_purchase_orders.csv` only if it exists.
- **Zoho Inventory:** press **Sync from Zoho**. It lists the organisation's purchase orders, keeps the open and
  partially received ones, reads each line's `sku`, `quantity`, `quantity_received` and `quantity_cancelled`, and
  matches the Zoho item SKU to our `SKU_ID`. Lines whose SKU isn't in the SKU master are reported and ignored.

To connect Zoho (one-time):

1. In the Zoho API console for your data centre (for India, https://api-console.zoho.in), add a **Self Client**.
2. Generate a grant code with scope `ZohoInventory.purchaseorders.READ`, and exchange it for a **refresh token**
   (`POST https://accounts.zoho.in/oauth/v2/token` with `grant_type=authorization_code`).
3. Set `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_ORG_ID` (Zoho Inventory → Settings →
   Organization profile) and `ZOHO_DC` in `.env.local` and in Vercel, then redeploy.

The Zoho field mapping (`lib/zoho/purchase-orders.ts`) follows Zoho Inventory's API v1 but has not yet been run
against a live Zoho organisation; check the first sync's numbers against Zoho.

## How Gemini is kept away from the numbers

- `lib/ai/facts.ts` builds the only payload Gemini sees: engine-computed numbers (rounded to 1 decimal), rule
  names, the decided action and quantity, and the thresholds. SKU names are left out because they contain numbers
  such as "500ml".
- `lib/ai/gemini.ts` asks for structured JSON (`{reason, brief}`) using a response schema, with instructions never
  to calculate or change anything.
- Every number in the reply is checked against the numbers that were sent (allowing only rounding). If Gemini
  produces any other number, the text is discarded and the error is shown on the SKU page. Tests:
  `lib/ai/facts.test.ts`.
- The action and quantity shown in the app always come from the engine, never from Gemini text.
- Results are cached in `ai_explanations` and keyed by a hash of the facts and the model. **Regenerate** forces a
  fresh call.

## Data model (`lib/db/schema.ts`)

- **Source data:** `skus`, `distributors`, `weekly_sales`, `inventory`, `festival_calendar`, `uploads`
- **Configuration:** `settings` (thresholds) and `settings_log` (every threshold or calendar change)
- **Output:** `runs` (one per recalculation, with a snapshot of the thresholds) and `recommendations` (one per SKU
  per run, with the full engine evaluation as JSON and the latest review state)
- **Audit:** `review_audit` (who, when, decision, original vs final quantity, note) and `ai_explanations`

## Assumptions

These are my readings of the brief. Each is easy to change.

1. **"Now" and the festival month.** "Now" is the latest ISO week in the sales data (2026-W42). The festival check
   uses the month of each SKU's `As_Of_Date` (2026-10, a festival month), not the month of "now". Here they are
   the same.
2. **Strict comparisons.** Stockout means cover < threshold; overstock means cover > threshold; high demand means
   avg4 > 1.2 × avg12. A value exactly on a threshold does not fire.
3. **Quantities.** 1.5 × standard is rounded **up** to whole units (e.g. 75 → 113).
4. **Overstock + high demand** (not in this data) conflict, so the engine recommends pausing the next order and
   marks the SKU as an exception.
5. **Missing data makes an exception with no automatic recommendation** (action "Planner review"). That covers:
   fewer than 12 weeks of history, any missing week inside the 12-week window (not treated as zero sales), no
   inventory record, zero sales across the window (cover cannot be computed), missing perishability or reorder
   quantity, and no calendar entry for the stock month.
6. **Distributor checks.** A distributor that is not `Active`, or not in the distributor master, makes the SKU an
   exception but keeps its recommendation. All four distributors are active today.
7. **Several stock locations** for one SKU are added together. The latest `As_Of_Date` is used.
8. **Runs are snapshots.** Recalculating creates a new run and leaves earlier runs and their reviews untouched.
   Threshold and calendar edits apply from the next run. The dashboard, review and approved pages always show
   the latest run.
9. **Reviews.** Approve keeps the engine quantity. Edit needs a whole-number quantity and a note. Reject needs a
   note. A decision can be changed later, and each change is a new audit row. Approving a "pause" records agreement
   but creates no order line. The reviewer's name is typed (no login) and remembered in the browser.
10. **Uploads.** Master data, sales and calendar rows are upserted by key. `current_inventory` and
    `open_purchase_orders` replace the whole snapshot. A file with any invalid row is rejected entirely.
11. **AI explanations** are generated on demand (button), not on every run, to save time and API cost. "No action"
    SKUs are not sent to Gemini.
12. **Open POs count in full.** Every unit ordered and not yet received counts towards cover, whatever its
    expected date; a late PO can therefore hide a stockout. The expected date is shown on the SKU page.
13. **Open questions from the build plan** that this version does not cover yet: sending approved POs to Zoho, per-distributor
    forecasts, login (Auth.js), email/WhatsApp alerts, scheduled SAP imports, and the Vercel Cron run.

## Project layout

```
app/                 Next.js pages, server actions (app/actions.ts), CSV export route
components/          Client components (forms, chart, badges)
lib/rules/           Rules engine, ISO-week helpers, input builder (pure, unit-tested)
lib/data/            CSV parsing/validation (pure) and DB loader
lib/ai/              Gemini facts, number guard, client and cache
lib/db/              Drizzle schema and client (Neon or PGlite)
lib/review.ts        Approve / edit / reject and approved-order queries
lib/settings*.ts     Thresholds, validation, change log
scripts/seed.ts      Loads /data and creates the first run
data/                The five sample CSVs
drizzle/             SQL migrations
```
