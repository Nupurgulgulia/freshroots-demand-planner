CREATE TABLE "open_purchase_orders" (
	"po_number" text NOT NULL,
	"sku_id" text NOT NULL,
	"ordered_qty" integer NOT NULL,
	"received_qty" integer DEFAULT 0 NOT NULL,
	"expected_date" text,
	"status" text NOT NULL,
	"source" text NOT NULL,
	"loaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "open_purchase_orders_po_number_sku_id_pk" PRIMARY KEY("po_number","sku_id")
);
