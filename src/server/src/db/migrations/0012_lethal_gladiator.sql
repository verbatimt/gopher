CREATE TABLE "finance_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"notes" text,
	"current_balance" numeric(14, 2) DEFAULT '0' NOT NULL,
	"type" text NOT NULL,
	CONSTRAINT "finance_accounts_type_chk" CHECK ("finance_accounts"."type" in ('Checking','Savings','Credit','Vendor','Payroll','Individual','Investment','Loan','Interest'))
);
--> statement-breakpoint
CREATE TABLE "finance_forecast_account_balances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"forecast_id" uuid NOT NULL,
	"forecast_account_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"type" text NOT NULL,
	"running_balance" numeric(14, 2) NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	"date" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finance_forecast_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"forecast_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"starting_balance" numeric(14, 2) NOT NULL,
	"ending_balance" numeric(14, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finance_forecast_ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"forecast_id" uuid NOT NULL,
	"forecast_transaction_id" uuid NOT NULL,
	"forecast_account_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"starting_balance" numeric(14, 2) NOT NULL,
	"ending_balance" numeric(14, 2) NOT NULL,
	"type" text NOT NULL,
	"origin" boolean NOT NULL,
	"transaction_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"date" date NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finance_forecast_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"forecast_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"origin_account_id" uuid NOT NULL,
	"destination_account_id" uuid NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"transfer_type" text NOT NULL,
	"transfer_amount" numeric(14, 2) NOT NULL,
	"start_date" date NOT NULL,
	"ending" text NOT NULL,
	"end_date" date,
	"recurrence_count" integer,
	"interval_unit" text NOT NULL,
	"frequency" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finance_forecasts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"household_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"description" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finance_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"household_id" uuid NOT NULL,
	"origin_account_id" uuid NOT NULL,
	"destination_account_id" uuid NOT NULL,
	"description" text NOT NULL,
	"notes" text,
	"forecast_included" boolean DEFAULT true NOT NULL,
	"category" text NOT NULL,
	"transfer_type" text NOT NULL,
	"transfer_amount" numeric(14, 2) NOT NULL,
	"start_date" date NOT NULL,
	"ending" text NOT NULL,
	"end_date" date,
	"recurrence_count" integer,
	"interval_unit" text NOT NULL,
	"frequency" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "finance_tx_category_chk" CHECK ("finance_transactions"."category" in ('Auto','Food','Holidays','Home','Medical','Misc','Pay','Personal','Pet','Services','Subscriptions','Taxes','Utilities','Vacation','Payment','Interest','Transfer','Savings','Investment')),
	CONSTRAINT "finance_tx_transfer_chk" CHECK ("finance_transactions"."transfer_type" in ('FixedAmount','OriginPercentage','DestinationPercentage')),
	CONSTRAINT "finance_tx_ending_chk" CHECK ("finance_transactions"."ending" in ('Ongoing','OnDate','AfterOccurrences')),
	CONSTRAINT "finance_tx_interval_chk" CHECK ("finance_transactions"."interval_unit" in ('Once','Daily','Weekly','Monthly','Yearly'))
);
--> statement-breakpoint
ALTER TABLE "finance_accounts" ADD CONSTRAINT "finance_accounts_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_forecast_account_balances" ADD CONSTRAINT "finance_forecast_account_balances_forecast_id_finance_forecasts_id_fk" FOREIGN KEY ("forecast_id") REFERENCES "public"."finance_forecasts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_forecast_account_balances" ADD CONSTRAINT "finance_forecast_account_balances_forecast_account_id_finance_forecast_accounts_id_fk" FOREIGN KEY ("forecast_account_id") REFERENCES "public"."finance_forecast_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_forecast_accounts" ADD CONSTRAINT "finance_forecast_accounts_forecast_id_finance_forecasts_id_fk" FOREIGN KEY ("forecast_id") REFERENCES "public"."finance_forecasts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_forecast_accounts" ADD CONSTRAINT "finance_forecast_accounts_account_id_finance_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."finance_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_forecast_ledger_entries" ADD CONSTRAINT "finance_forecast_ledger_entries_forecast_id_finance_forecasts_id_fk" FOREIGN KEY ("forecast_id") REFERENCES "public"."finance_forecasts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_forecast_ledger_entries" ADD CONSTRAINT "finance_forecast_ledger_entries_forecast_transaction_id_finance_forecast_transactions_id_fk" FOREIGN KEY ("forecast_transaction_id") REFERENCES "public"."finance_forecast_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_forecast_ledger_entries" ADD CONSTRAINT "finance_forecast_ledger_entries_forecast_account_id_finance_forecast_accounts_id_fk" FOREIGN KEY ("forecast_account_id") REFERENCES "public"."finance_forecast_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_forecast_transactions" ADD CONSTRAINT "finance_forecast_transactions_forecast_id_finance_forecasts_id_fk" FOREIGN KEY ("forecast_id") REFERENCES "public"."finance_forecasts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_forecast_transactions" ADD CONSTRAINT "finance_forecast_transactions_transaction_id_finance_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."finance_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_forecasts" ADD CONSTRAINT "finance_forecasts_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_origin_account_id_finance_accounts_id_fk" FOREIGN KEY ("origin_account_id") REFERENCES "public"."finance_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_destination_account_id_finance_accounts_id_fk" FOREIGN KEY ("destination_account_id") REFERENCES "public"."finance_accounts"("id") ON DELETE no action ON UPDATE no action;