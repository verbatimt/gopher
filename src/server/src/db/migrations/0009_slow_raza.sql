CREATE TABLE "reward_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"points" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reward_store_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"point_cost" integer NOT NULL,
	"redemption_cap" integer,
	"redemption_count" integer DEFAULT 0 NOT NULL,
	"cooldown_minutes" integer
);
--> statement-breakpoint
CREATE TABLE "reward_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"household_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"type" text NOT NULL,
	"amount" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"task_id" uuid,
	"store_item_id" uuid,
	"status" text DEFAULT 'approved' NOT NULL,
	"notes" text,
	"created_by" uuid,
	CONSTRAINT "reward_transactions_type_chk" CHECK ("reward_transactions"."type" in ('earn','redeem','adjustment')),
	CONSTRAINT "reward_transactions_status_chk" CHECK ("reward_transactions"."status" in ('pending','approved','rejected'))
);
--> statement-breakpoint
CREATE TABLE "rewards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"household_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"lifetime_earned" integer DEFAULT 0 NOT NULL,
	"lifetime_redeemed" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rewards_memberId_unique" UNIQUE("member_id")
);
--> statement-breakpoint
ALTER TABLE "reward_rules" ADD CONSTRAINT "reward_rules_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_store_items" ADD CONSTRAINT "reward_store_items_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_transactions" ADD CONSTRAINT "reward_transactions_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_transactions" ADD CONSTRAINT "reward_transactions_member_id_household_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."household_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_transactions" ADD CONSTRAINT "reward_transactions_store_item_id_reward_store_items_id_fk" FOREIGN KEY ("store_item_id") REFERENCES "public"."reward_store_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rewards" ADD CONSTRAINT "rewards_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rewards" ADD CONSTRAINT "rewards_member_id_household_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."household_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reward_transactions_member_idx" ON "reward_transactions" USING btree ("member_id","created_at");--> statement-breakpoint
CREATE INDEX "reward_transactions_task_idx" ON "reward_transactions" USING btree ("task_id");