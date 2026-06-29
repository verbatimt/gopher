CREATE TABLE "reward_allowances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"household_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"name" text,
	"points" integer NOT NULL,
	"rrule" text NOT NULL,
	"last_granted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "reward_allowances" ADD CONSTRAINT "reward_allowances_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_allowances" ADD CONSTRAINT "reward_allowances_member_id_household_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."household_members"("id") ON DELETE no action ON UPDATE no action;