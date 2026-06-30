// Unit tests for the client-side meal-plan nutrition aggregation (ADR-0005).

import 'package:flutter_test/flutter_test.dart';
import 'package:gopher/models/meal.dart';
import 'package:gopher/models/nutrition.dart';
import 'package:gopher/models/recipe.dart';

Recipe _r(String id, {int servings = 1, int? cal, double? p, double? c, double? f}) => Recipe(
      id: id,
      name: id,
      servings: servings,
      calories: cal,
      proteinGrams: p,
      carbsGrams: c,
      fatGrams: f,
    );

MealEntry _e(int day, String type, {String? recipeId, int? servings}) => MealEntry(
      id: '$day-$type',
      dayOfWeek: day,
      mealType: type,
      mealName: 'm',
      recipeId: recipeId,
      servings: servings,
    );

void main() {
  test('entryNutrition scales by entry.servings / recipe.servings', () {
    final recipes = {'a': _r('a', servings: 2, cal: 400, p: 20, c: 50, f: 10)};
    final n = entryNutrition(_e(0, 'dinner', recipeId: 'a', servings: 4), recipes);
    expect(n.calories, 800);
    expect(n.protein, 40);
    expect(n.carbs, 100);
    expect(n.fat, 20);
  });

  test('entryNutrition uses factor 1 when entry servings is null', () {
    final recipes = {'a': _r('a', servings: 2, cal: 400)};
    expect(entryNutrition(_e(0, 'dinner', recipeId: 'a'), recipes).calories, 400);
  });

  test('no recipe / unknown recipe / no nutrition contribute nothing', () {
    final recipes = {'a': _r('a', cal: 100), 'b': _r('b')}; // b carries no nutrition
    expect(entryNutrition(_e(0, 'dinner'), recipes).isEmpty, isTrue); // no recipeId
    expect(entryNutrition(_e(0, 'dinner', recipeId: 'zzz'), recipes).isEmpty, isTrue); // unknown id
    expect(entryNutrition(_e(0, 'dinner', recipeId: 'b'), recipes).isEmpty, isTrue); // no macros
  });

  test('dailyTotals sums per day and omits days without nutrition', () {
    final recipes = {
      'a': _r('a', cal: 100, p: 5),
      'b': _r('b', cal: 200, p: 10),
    };
    final entries = [
      _e(1, 'breakfast', recipeId: 'a'),
      _e(1, 'dinner', recipeId: 'b', servings: 2), // 2× b → 400 kcal, 20 g protein
      _e(2, 'lunch'), // free-text, no recipe → ignored
    ];
    final totals = dailyTotals(entries, recipes);
    expect(totals.containsKey(0), isFalse);
    expect(totals[1]!.calories, 500); // 100 + 400
    expect(totals[1]!.protein, 25); // 5 + 20
    expect(totals.containsKey(2), isFalse); // the only day-2 entry has no recipe
  });
}
