CREATE TABLE "occurrence_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scheduled_item_id" uuid NOT NULL,
	"occurrence_date" date NOT NULL,
	"status" text,
	"time_override" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "occurrence_overrides_item_date_uq" UNIQUE("scheduled_item_id","occurrence_date")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scheduled_item_id" uuid NOT NULL,
	"location" text,
	"url" text,
	"visibility" text DEFAULT 'family' NOT NULL,
	"participants" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"reminder_minutes_before" integer,
	CONSTRAINT "events_scheduledItemId_unique" UNIQUE("scheduled_item_id")
);
--> statement-breakpoint
CREATE TABLE "scheduled_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"household_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"all_day" boolean DEFAULT false NOT NULL,
	"rrule" text,
	"rrule_until" timestamp with time zone,
	"visibility" text DEFAULT 'family' NOT NULL,
	"assignee_member_id" uuid,
	"time_of_day" text DEFAULT 'anytime' NOT NULL,
	"custom_window_id" uuid,
	"pinned_time" text,
	"duration_minutes" integer,
	"location" text,
	"unskippable" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	CONSTRAINT "scheduled_items_type_chk" CHECK ("scheduled_items"."type" in ('appointment','event','recurring_task','task')),
	CONSTRAINT "scheduled_items_visibility_chk" CHECK ("scheduled_items"."visibility" in ('personal','family')),
	CONSTRAINT "scheduled_items_tod_chk" CHECK ("scheduled_items"."time_of_day" in ('anytime','morning','afternoon','evening','custom'))
);
--> statement-breakpoint
CREATE TABLE "scheduled_item_tags" (
	"scheduled_item_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "scheduled_item_tags_scheduled_item_id_tag_id_pk" PRIMARY KEY("scheduled_item_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "scheduling_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "scheduling_tags_household_name_uq" UNIQUE("household_id","name")
);
--> statement-breakpoint
CREATE TABLE "time_windows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"start_minute" integer NOT NULL,
	"end_minute" integer NOT NULL,
	CONSTRAINT "time_windows_household_name_uq" UNIQUE("household_id","name"),
	CONSTRAINT "time_windows_range_chk" CHECK ("time_windows"."start_minute" >= 0 and "time_windows"."end_minute" <= 1439 and "time_windows"."start_minute" < "time_windows"."end_minute")
);
--> statement-breakpoint
ALTER TABLE "occurrence_overrides" ADD CONSTRAINT "occurrence_overrides_scheduled_item_id_scheduled_items_id_fk" FOREIGN KEY ("scheduled_item_id") REFERENCES "public"."scheduled_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_scheduled_item_id_scheduled_items_id_fk" FOREIGN KEY ("scheduled_item_id") REFERENCES "public"."scheduled_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_items" ADD CONSTRAINT "scheduled_items_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_items" ADD CONSTRAINT "scheduled_items_assignee_member_id_household_members_id_fk" FOREIGN KEY ("assignee_member_id") REFERENCES "public"."household_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_item_tags" ADD CONSTRAINT "scheduled_item_tags_scheduled_item_id_scheduled_items_id_fk" FOREIGN KEY ("scheduled_item_id") REFERENCES "public"."scheduled_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_item_tags" ADD CONSTRAINT "scheduled_item_tags_tag_id_scheduling_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."scheduling_tags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduling_tags" ADD CONSTRAINT "scheduling_tags_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_windows" ADD CONSTRAINT "time_windows_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scheduled_items_household_starts_idx" ON "scheduled_items" USING btree ("household_id","starts_at","rrule_until");