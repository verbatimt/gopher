CREATE TABLE "demo_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "demo_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category_id" uuid
);
--> statement-breakpoint
CREATE TABLE "demo_links" (
	"household_id" uuid NOT NULL,
	"left_id" uuid NOT NULL,
	"right_id" uuid NOT NULL,
	CONSTRAINT "demo_links_left_id_right_id_pk" PRIMARY KEY("left_id","right_id")
);
--> statement-breakpoint
ALTER TABLE "demo_items" ADD CONSTRAINT "demo_items_category_id_demo_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."demo_categories"("id") ON DELETE no action ON UPDATE no action;