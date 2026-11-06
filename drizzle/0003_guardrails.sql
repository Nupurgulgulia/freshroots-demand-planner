CREATE TABLE "ai_usage" (
	"month" text PRIMARY KEY NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "needs_confirmation" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "confirmed_by" text;--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "confirmed_by_user_id" integer;--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_confirmed_by_user_id_users_id_fk" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;