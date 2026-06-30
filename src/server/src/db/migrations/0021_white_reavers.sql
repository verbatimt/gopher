ALTER TABLE "recipes" ADD COLUMN "calories" integer;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "protein_grams" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "carbs_grams" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "fat_grams" numeric(10, 2);