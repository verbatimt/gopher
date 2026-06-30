CREATE TABLE "inventory_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"item_id" uuid NOT NULL,
	"delta" numeric(12, 2) NOT NULL,
	"reason" text NOT NULL,
	"resulting_quantity" numeric(12, 2) NOT NULL,
	"adjusted_by" uuid,
	"note" text,
	CONSTRAINT "inventory_adjustments_reason_chk" CHECK ("inventory_adjustments"."reason" in ('restock','consume','correction','expired'))
);
--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"unit" text,
	"quantity" numeric(12, 2) DEFAULT '0' NOT NULL,
	"location" text,
	"low_threshold" numeric(12, 2),
	"expires_at" date,
	"barcode" text,
	"auto_add_to_grocery" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_by" uuid
);
--> statement-breakpoint
ALTER TABLE "households" ALTER COLUMN "active_modules" SET DEFAULT '{calendar,tasks,medications,health,rewards,finance,meals,inventory}'::text[];--> statement-breakpoint
ALTER TABLE "inventory_adjustments" ADD CONSTRAINT "inventory_adjustments_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_adjustments" ADD CONSTRAINT "inventory_adjustments_adjusted_by_household_members_id_fk" FOREIGN KEY ("adjusted_by") REFERENCES "public"."household_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_created_by_household_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."household_members"("id") ON DELETE no action ON UPDATE no action;