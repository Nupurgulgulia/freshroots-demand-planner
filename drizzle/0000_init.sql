CREATE TABLE "ai_explanations" (
	"recommendation_id" integer PRIMARY KEY NOT NULL,
	"reason" text,
	"brief" text,
	"model" text NOT NULL,
	"input_hash" text NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "distributors" (
	"distributor_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"region" text NOT NULL,
	"status" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "festival_calendar" (
	"year_month" text PRIMARY KEY NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"is_festival_month" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory" (
	"sku_id" text NOT NULL,
	"location" text NOT NULL,
	"units_on_hand" integer NOT NULL,
	"as_of_date" text NOT NULL,
	CONSTRAINT "inventory_sku_id_location_pk" PRIMARY KEY("sku_id","location")
);
--> statement-breakpoint
CREATE TABLE "recommendations" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"sku_id" text NOT NULL,
	"flag" text NOT NULL,
	"action" text NOT NULL,
	"quantity" integer,
	"is_exception" boolean NOT NULL,
	"rules_fired" jsonb NOT NULL,
	"exception_reasons" jsonb NOT NULL,
	"evaluation" jsonb NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"final_quantity" integer,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"review_note" text
);
--> statement-breakpoint
CREATE TABLE "review_audit" (
	"id" serial PRIMARY KEY NOT NULL,
	"recommendation_id" integer NOT NULL,
	"run_id" integer NOT NULL,
	"sku_id" text NOT NULL,
	"decision" text NOT NULL,
	"reviewer" text NOT NULL,
	"original_action" text NOT NULL,
	"original_quantity" integer,
	"final_quantity" integer,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"now_week" text NOT NULL,
	"thresholds" jsonb NOT NULL,
	"triggered_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" double precision NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"area" text NOT NULL,
	"key" text NOT NULL,
	"old_value" text,
	"new_value" text NOT NULL,
	"changed_by" text NOT NULL,
	"note" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skus" (
	"sku_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"perishability" text NOT NULL,
	"standard_reorder_qty" integer NOT NULL,
	"unit_of_measure" text NOT NULL,
	"distributor_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "uploads" (
	"id" serial PRIMARY KEY NOT NULL,
	"dataset" text NOT NULL,
	"file_name" text NOT NULL,
	"row_count" integer NOT NULL,
	"uploaded_by" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weekly_sales" (
	"sku_id" text NOT NULL,
	"week" text NOT NULL,
	"units_sold" integer NOT NULL,
	CONSTRAINT "weekly_sales_sku_id_week_pk" PRIMARY KEY("sku_id","week")
);
--> statement-breakpoint
ALTER TABLE "ai_explanations" ADD CONSTRAINT "ai_explanations_recommendation_id_recommendations_id_fk" FOREIGN KEY ("recommendation_id") REFERENCES "public"."recommendations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_audit" ADD CONSTRAINT "review_audit_recommendation_id_recommendations_id_fk" FOREIGN KEY ("recommendation_id") REFERENCES "public"."recommendations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recommendations_run_idx" ON "recommendations" USING btree ("run_id");