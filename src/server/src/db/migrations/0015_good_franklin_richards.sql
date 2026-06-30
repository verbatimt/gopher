CREATE TABLE "biometric_measurements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"household_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"type_id" uuid NOT NULL,
	"value_numeric" numeric(10, 2) NOT NULL,
	"value_secondary" numeric(10, 2),
	"unit" text NOT NULL,
	"measured_at" timestamp with time zone NOT NULL,
	"notes" text,
	"recorded_by" uuid
);
--> statement-breakpoint
CREATE TABLE "measurement_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"household_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"type_id" uuid NOT NULL,
	"min_target" numeric,
	"max_target" numeric,
	"goal_value" numeric,
	CONSTRAINT "measurement_targets_member_type_uq" UNIQUE("member_id","type_id")
);
--> statement-breakpoint
CREATE TABLE "measurement_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"household_id" uuid,
	"key" text NOT NULL,
	"display_name" text NOT NULL,
	"value_shape" text DEFAULT 'single' NOT NULL,
	"unit_default" text NOT NULL,
	"precision" integer DEFAULT 1 NOT NULL,
	"min_normal" numeric,
	"max_normal" numeric,
	CONSTRAINT "measurement_types_value_shape_chk" CHECK ("measurement_types"."value_shape" in ('single','dual')),
	CONSTRAINT "measurement_types_precision_chk" CHECK ("measurement_types"."precision" >= 0 and "measurement_types"."precision" <= 6)
);
--> statement-breakpoint
ALTER TABLE "biometric_measurements" ADD CONSTRAINT "biometric_measurements_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biometric_measurements" ADD CONSTRAINT "biometric_measurements_member_id_household_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."household_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biometric_measurements" ADD CONSTRAINT "biometric_measurements_type_id_measurement_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."measurement_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biometric_measurements" ADD CONSTRAINT "biometric_measurements_recorded_by_household_members_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."household_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurement_targets" ADD CONSTRAINT "measurement_targets_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurement_targets" ADD CONSTRAINT "measurement_targets_member_id_household_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."household_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurement_targets" ADD CONSTRAINT "measurement_targets_type_id_measurement_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."measurement_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurement_types" ADD CONSTRAINT "measurement_types_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "measurement_types_default_key_uq" ON "measurement_types" USING btree ("key") WHERE household_id is null;--> statement-breakpoint
CREATE UNIQUE INDEX "measurement_types_household_key_uq" ON "measurement_types" USING btree ("household_id","key") WHERE household_id is not null;