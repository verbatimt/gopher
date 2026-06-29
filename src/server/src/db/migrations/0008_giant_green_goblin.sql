CREATE TABLE "medication_doses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"schedule_id" uuid NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"logged_at" timestamp with time zone,
	"logged_by" uuid,
	"notes" text,
	CONSTRAINT "medication_doses_schedule_scheduled_uq" UNIQUE("schedule_id","scheduled_at"),
	CONSTRAINT "medication_doses_status_chk" CHECK ("medication_doses"."status" in ('pending','taken','skipped','missed'))
);
--> statement-breakpoint
CREATE TABLE "medication_refills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"schedule_id" uuid NOT NULL,
	"refill_date" date DEFAULT CURRENT_DATE NOT NULL,
	"quantity_added" numeric NOT NULL,
	"logged_by" uuid NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "medication_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"household_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"medication_name" text NOT NULL,
	"dosage_amount" numeric NOT NULL,
	"dosage_unit" text NOT NULL,
	"rrule" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"stock_quantity" numeric DEFAULT '0' NOT NULL,
	"refill_threshold" numeric DEFAULT '0' NOT NULL,
	"dose_window_minutes" integer DEFAULT 120 NOT NULL,
	"notes" text
);
--> statement-breakpoint
ALTER TABLE "medication_doses" ADD CONSTRAINT "medication_doses_schedule_id_medication_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."medication_schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medication_doses" ADD CONSTRAINT "medication_doses_logged_by_household_members_id_fk" FOREIGN KEY ("logged_by") REFERENCES "public"."household_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medication_refills" ADD CONSTRAINT "medication_refills_schedule_id_medication_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."medication_schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medication_refills" ADD CONSTRAINT "medication_refills_logged_by_household_members_id_fk" FOREIGN KEY ("logged_by") REFERENCES "public"."household_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medication_schedules" ADD CONSTRAINT "medication_schedules_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medication_schedules" ADD CONSTRAINT "medication_schedules_member_id_household_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."household_members"("id") ON DELETE no action ON UPDATE no action;