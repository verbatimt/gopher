// Client-side nutrition aggregation (ADR-0005): roll a week's planned meals up into per-day
// macro totals. Each planned entry contributes its linked recipe's nutrition scaled by
// (entry.servings / recipe.servings) — mirroring the EP-0046 grocery-derivation factor.
// Entries with no recipe link, an unknown recipe, or a recipe without nutrition contribute
// nothing. Household-scoped; no per-member breakdown.

import 'meal.dart';
import 'recipe.dart';

/// Summed macros. All values are non-negative; grams/kcal are doubles for clean scaling.
class NutritionTotals {
  final double calories;
  final double protein;
  final double carbs;
  final double fat;

  const NutritionTotals({
    this.calories = 0,
    this.protein = 0,
    this.carbs = 0,
    this.fat = 0,
  });

  bool get isEmpty => calories == 0 && protein == 0 && carbs == 0 && fat == 0;

  NutritionTotals operator +(NutritionTotals other) => NutritionTotals(
        calories: calories + other.calories,
        protein: protein + other.protein,
        carbs: carbs + other.carbs,
        fat: fat + other.fat,
      );
}

/// Macros contributed by a single planned entry, scaled by servings. Returns an empty total
/// when the entry has no recipe link, the recipe is unknown, or it carries no nutrition.
NutritionTotals entryNutrition(MealEntry entry, Map<String, Recipe> recipesById) {
  final id = entry.recipeId;
  if (id == null) return const NutritionTotals();
  final recipe = recipesById[id];
  if (recipe == null || !recipe.hasNutrition) return const NutritionTotals();
  final base = recipe.servings > 0 ? recipe.servings : 1;
  final factor =
      (entry.servings != null && entry.servings! > 0) ? entry.servings! / base : 1.0;
  return NutritionTotals(
    calories: (recipe.calories ?? 0) * factor,
    protein: (recipe.proteinGrams ?? 0) * factor,
    carbs: (recipe.carbsGrams ?? 0) * factor,
    fat: (recipe.fatGrams ?? 0) * factor,
  );
}

/// Per-day-of-week (0..6) macro totals for a week's entries. Days with no nutrition are omitted.
Map<int, NutritionTotals> dailyTotals(
  Iterable<MealEntry> entries,
  Map<String, Recipe> recipesById,
) {
  final out = <int, NutritionTotals>{};
  for (final entry in entries) {
    final contribution = entryNutrition(entry, recipesById);
    if (contribution.isEmpty) continue;
    out[entry.dayOfWeek] = (out[entry.dayOfWeek] ?? const NutritionTotals()) + contribution;
  }
  return out;
}
