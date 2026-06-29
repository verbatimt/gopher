CREATE TABLE "recurring_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scheduled_item_id" uuid NOT NULL,
	"rotation_pool" uuid[],
	"rotation_index" integer DEFAULT 0 NOT NULL,
	"assignment_count" integer,
	"generate_ahead_days" integer DEFAULT 30 NOT NULL,
	"last_generated_at" timestamp with time zone,
	"reward_rule_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "recurring_tasks_scheduledItemId_unique" UNIQUE("scheduled_item_id")
);
--> statement-breakpoint
CREATE TABLE "task_workflow_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"step_order" integer NOT NULL,
	"description" text NOT NULL,
	"is_completed" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by" uuid,
	"passive" boolean DEFAULT false NOT NULL,
	"duration_minutes" integer,
	CONSTRAINT "task_workflow_steps_task_order_uq" UNIQUE("task_id","step_order")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scheduled_item_id" uuid NOT NULL,
	"recurring_task_id" uuid,
	"occurrence_date" date,
	"assigned_to" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by" uuid,
	"requires_approval" boolean DEFAULT false NOT NULL,
	"reward_rule_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_scheduledItemId_unique" UNIQUE("scheduled_item_id"),
	CONSTRAINT "tasks_recurring_occurrence_uq" UNIQUE("recurring_task_id","occurrence_date"),
	CONSTRAINT "tasks_status_chk" CHECK ("tasks"."status" in ('pending','in_progress','completed','skipped','cancelled'))
);
--> statement-breakpoint
ALTER TABLE "recurring_tasks" ADD CONSTRAINT "recurring_tasks_scheduled_item_id_scheduled_items_id_fk" FOREIGN KEY ("scheduled_item_id") REFERENCES "public"."scheduled_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_workflow_steps" ADD CONSTRAINT "task_workflow_steps_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_scheduled_item_id_scheduled_items_id_fk" FOREIGN KEY ("scheduled_item_id") REFERENCES "public"."scheduled_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_recurring_task_id_recurring_tasks_id_fk" FOREIGN KEY ("recurring_task_id") REFERENCES "public"."recurring_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_to_household_members_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."household_members"("id") ON DELETE no action ON UPDATE no action;