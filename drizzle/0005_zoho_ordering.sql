CREATE TABLE "zoho_item_map" (
	"sku_id" text PRIMARY KEY NOT NULL,
	"zoho_item_id" text NOT NULL,
	"zoho_item_name" text,
	"updated_by" text NOT NULL,
	"user_id" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "zoho_po_sends" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"distributor_id" text NOT NULL,
	"reference" text NOT NULL,
	"status" text NOT NULL,
	"zoho_purchaseorder_id" text,
	"zoho_purchaseorder_number" text,
	"line_count" integer NOT NULL,
	"units" integer NOT NULL,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"sent_by" text NOT NULL,
	"user_id" integer,
	"last_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "zoho_po_sends_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "zoho_vendor_map" (
	"distributor_id" text PRIMARY KEY NOT NULL,
	"zoho_vendor_id" text NOT NULL,
	"zoho_vendor_name" text,
	"updated_by" text NOT NULL,
	"user_id" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "zoho_purchaseorder_id" text;--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "zoho_purchaseorder_number" text;--> statement-breakpoint
ALTER TABLE "zoho_item_map" ADD CONSTRAINT "zoho_item_map_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zoho_po_sends" ADD CONSTRAINT "zoho_po_sends_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zoho_po_sends" ADD CONSTRAINT "zoho_po_sends_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zoho_vendor_map" ADD CONSTRAINT "zoho_vendor_map_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "zoho_po_sends_run_distributor_idx" ON "zoho_po_sends" USING btree ("run_id","distributor_id");