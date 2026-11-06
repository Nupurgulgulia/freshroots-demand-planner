CREATE TABLE "inventory_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"snapshot_at" timestamp with time zone NOT NULL,
	"sku_id" text NOT NULL,
	"location" text NOT NULL,
	"units_on_hand" integer NOT NULL,
	"as_of_date" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quarterly_figures" (
	"quarter" text PRIMARY KEY NOT NULL,
	"baseline_loss" double precision,
	"target_loss" double precision,
	"actual_loss" double precision,
	"note" text,
	"entered_by" text NOT NULL,
	"user_id" integer,
	"entered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "skus" ADD COLUMN "unit_price" double precision;--> statement-breakpoint
ALTER TABLE "quarterly_figures" ADD CONSTRAINT "quarterly_figures_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_snapshots_at_idx" ON "inventory_snapshots" USING btree ("snapshot_at");