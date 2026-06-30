ALTER TABLE "meal_plan_entries" ADD COLUMN "recipe_id" uuid;--> statement-breakpoint
ALTER TABLE "meal_plan_entries" ADD COLUMN "servings" integer;--> statement-breakpoint
ALTER TABLE "meal_plan_entries" ADD CONSTRAINT "meal_plan_entries_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE set null ON UPDATE no action;