import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

// ---------- Users and sign-in ----------

/** People who can sign in. Created with `npm run invite`; passwords are scrypt hashes, never plain text. */
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(), // stored lower-case
  email: text("email").notNull(),
  role: text("role").notNull(), // planner | procurement | viewer
  passwordHash: text("password_hash").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

/** Failed sign-ins per username, for the 5-attempts / 15-minute lockout. */
export const loginAttempts = pgTable("login_attempts", {
  username: text("username").primaryKey(), // lower-case; also tracks names that don't exist
  failedCount: integer("failed_count").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  lastFailedAt: timestamp("last_failed_at", { withTimezone: true }),
});

// ---------- Source data (loaded from CSV) ----------

export const distributors = pgTable("distributors", {
  distributorId: text("distributor_id").primaryKey(),
  name: text("name").notNull(),
  region: text("region").notNull(),
  status: text("status").notNull(),
});

export const skus = pgTable("skus", {
  skuId: text("sku_id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  perishability: text("perishability").notNull(),
  standardReorderQty: integer("standard_reorder_qty").notNull(),
  unitOfMeasure: text("unit_of_measure").notNull(),
  distributorId: text("distributor_id").notNull(),
});

export const weeklySales = pgTable(
  "weekly_sales",
  {
    skuId: text("sku_id").notNull(),
    week: text("week").notNull(), // ISO week, e.g. 2026-W42
    unitsSold: integer("units_sold").notNull(),
  },
  (t) => [primaryKey({ columns: [t.skuId, t.week] })],
);

export const inventory = pgTable(
  "inventory",
  {
    skuId: text("sku_id").notNull(),
    location: text("location").notNull(),
    unitsOnHand: integer("units_on_hand").notNull(),
    asOfDate: text("as_of_date").notNull(), // YYYY-MM-DD
  },
  (t) => [primaryKey({ columns: [t.skuId, t.location] })],
);

/** Purchase orders not yet fully received, one row per PO line. Replaced on every CSV upload or Zoho sync. */
export const openPurchaseOrders = pgTable(
  "open_purchase_orders",
  {
    poNumber: text("po_number").notNull(),
    skuId: text("sku_id").notNull(),
    orderedQty: integer("ordered_qty").notNull(),
    receivedQty: integer("received_qty").notNull().default(0),
    expectedDate: text("expected_date"), // YYYY-MM-DD
    status: text("status").notNull(),
    source: text("source").notNull(), // "csv" | "zoho"
    loadedAt: timestamp("loaded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.poNumber, t.skuId] })],
);

export const festivalCalendar = pgTable("festival_calendar", {
  yearMonth: text("year_month").primaryKey(), // YYYY-MM
  year: integer("year").notNull(),
  month: integer("month").notNull(),
  isFestivalMonth: boolean("is_festival_month").notNull(),
});

export const uploads = pgTable("uploads", {
  id: serial("id").primaryKey(),
  dataset: text("dataset").notNull(),
  fileName: text("file_name").notNull(),
  rowCount: integer("row_count").notNull(),
  uploadedBy: text("uploaded_by").notNull(),
  userId: integer("user_id").references(() => users.id),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------- Editable thresholds and their change log ----------

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: doublePrecision("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text("updated_by").notNull(),
});

/** Every change to a threshold or the festival calendar. */
export const settingsLog = pgTable("settings_log", {
  id: serial("id").primaryKey(),
  area: text("area").notNull(), // "threshold" | "calendar"
  key: text("key").notNull(),
  oldValue: text("old_value"),
  newValue: text("new_value").notNull(),
  changedBy: text("changed_by").notNull(),
  userId: integer("user_id").references(() => users.id),
  note: text("note"),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------- Engine output ----------

export const runs = pgTable("runs", {
  id: serial("id").primaryKey(),
  nowWeek: text("now_week").notNull(),
  thresholds: jsonb("thresholds").notNull(),
  triggeredBy: text("triggered_by").notNull(),
  userId: integer("user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const recommendations = pgTable(
  "recommendations",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id")
      .notNull()
      .references(() => runs.id),
    skuId: text("sku_id").notNull(),
    flag: text("flag").notNull(),
    action: text("action").notNull(),
    quantity: integer("quantity"),
    isException: boolean("is_exception").notNull(),
    rulesFired: jsonb("rules_fired").$type<string[]>().notNull(),
    exceptionReasons: jsonb("exception_reasons").$type<string[]>().notNull(),
    /** Full engine Evaluation, so the detail page shows exactly what was decided on. */
    evaluation: jsonb("evaluation").notNull(),
    reason: text("reason").notNull(),
    // Latest review state; the full history is in review_audit.
    status: text("status").notNull().default("PENDING"), // PENDING | APPROVED | EDITED | REJECTED | NO_ACTION
    finalQuantity: integer("final_quantity"),
    reviewedBy: text("reviewed_by"),
    reviewedByUserId: integer("reviewed_by_user_id").references(() => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewNote: text("review_note"),
    // Quantity cap: set when the approved quantity is above maxQtyMultiple × the standard reorder quantity;
    // the line is not ready to send until procurement confirms it.
    needsConfirmation: boolean("needs_confirmation").notNull().default(false),
    confirmedBy: text("confirmed_by"),
    confirmedByUserId: integer("confirmed_by_user_id").references(() => users.id),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  },
  (t) => [index("recommendations_run_idx").on(t.runId)],
);

/** Gemini calls per calendar month (IST), for the AI_MONTHLY_CALL_CAP spend cap. */
export const aiUsage = pgTable("ai_usage", {
  month: text("month").primaryKey(), // YYYY-MM
  calls: integer("calls").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Cached Gemini output per recommendation. */
export const aiExplanations = pgTable("ai_explanations", {
  recommendationId: integer("recommendation_id")
    .primaryKey()
    .references(() => recommendations.id),
  reason: text("reason"),
  brief: text("brief"),
  model: text("model").notNull(),
  inputHash: text("input_hash").notNull(),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const reviewAudit = pgTable("review_audit", {
  id: serial("id").primaryKey(),
  recommendationId: integer("recommendation_id")
    .notNull()
    .references(() => recommendations.id),
  runId: integer("run_id").notNull(),
  skuId: text("sku_id").notNull(),
  decision: text("decision").notNull(), // APPROVED | EDITED | REJECTED
  reviewer: text("reviewer").notNull(),
  userId: integer("user_id").references(() => users.id),
  originalAction: text("original_action").notNull(),
  originalQuantity: integer("original_quantity"),
  finalQuantity: integer("final_quantity"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
