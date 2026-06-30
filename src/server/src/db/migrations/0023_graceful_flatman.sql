ALTER TABLE "meal_plan_entries" ADD COLUMN "scope" text DEFAULT 'family' NOT NULL;--> statement-breakpoint
ALTER TABLE "meal_plan_entries" ADD COLUMN "member_id" uuid;--> statement-breakpoint
ALTER TABLE "meal_plan_entries" ADD CONSTRAINT "meal_plan_entries_member_id_household_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."household_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plan_entries" ADD CONSTRAINT "meal_plan_entries_scope_chk" CHECK ("meal_plan_entries"."scope" in ('family','personal'));