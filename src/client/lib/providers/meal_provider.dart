import '../models/meal.dart';
import '../services/meal_service.dart';
import 'base_provider.dart';

/// Meal-planning state: the plan for the selected week (created lazily on first edit), plus
/// the household grocery list (EP-0030).
class MealProvider extends BaseProvider {
  final MealService _service;

  String? _householdId;
  String _weekStart = '';
  MealPlan? _plan;
  List<GroceryItem> _grocery = [];

  MealProvider(this._service);

  String get weekStart => _weekStart;
  MealPlan? get plan => _plan;
  List<GroceryItem> get grocery => List.unmodifiable(_grocery);

  /// Sunday (day 0) of the week containing [date], as 'YYYY-MM-DD'.
  static String weekStartOf(DateTime date) {
    final sunday = DateTime(date.year, date.month, date.day).subtract(Duration(days: date.weekday % 7));
    return '${sunday.year.toString().padLeft(4, '0')}-${sunday.month.toString().padLeft(2, '0')}-${sunday.day.toString().padLeft(2, '0')}';
  }

  Future<void> loadWeek(String householdId, String weekStart) async {
    _householdId = householdId;
    _weekStart = weekStart;
    await runGuarded(() async {
      final plans = await _service.listPlans(householdId, weekStart: weekStart);
      _plan = plans.isEmpty ? null : await _service.getPlan(householdId, plans.first.id);
    });
    notifyListeners();
  }

  Future<bool> setEntry(
    int dayOfWeek,
    String mealType,
    String mealName, {
    String? recipeId,
    int? servings,
  }) async {
    final h = _householdId;
    if (h == null) return false;
    return (await runGuarded(() async {
          var plan = _plan;
          plan ??= await _service.createPlan(h, _weekStart);
          await _service.upsertEntry(h, plan.id, {
            'dayOfWeek': dayOfWeek,
            'mealType': mealType,
            if (mealName.isNotEmpty) 'mealName': mealName,
            'recipeId': recipeId,
            'servings': ?servings,
          });
          _plan = await _service.getPlan(h, plan.id);
          notifyListeners();
          return true;
        })) ??
        false;
  }

  /// EP-0046: push the current plan's recipe-derived ingredients to the grocery list.
  Future<Map<String, int>?> addPlanIngredientsToGrocery() async {
    final h = _householdId;
    final plan = _plan;
    if (h == null || plan == null) return null;
    final result = await runGuarded(() => _service.seedFromPlanIngredients(h, plan.id));
    if (result != null) await loadGrocery();
    return result;
  }

  Future<void> deleteEntry(String entryId) async {
    final h = _householdId;
    final plan = _plan;
    if (h == null || plan == null) return;
    await runGuarded(() async {
      await _service.deleteEntry(h, plan.id, entryId);
      _plan = await _service.getPlan(h, plan.id);
      notifyListeners();
    });
  }

  Future<bool> copyToNextWeek() async {
    final h = _householdId;
    final plan = _plan;
    if (h == null || plan == null) return false;
    final next = _addDays(_weekStart, 7);
    final ok = await runGuarded(() async {
      await _service.copyPlan(h, plan.id, next);
      return true;
    });
    return ok == true;
  }

  Future<void> loadGrocery() async {
    final h = _householdId;
    if (h == null) return;
    final items = await runGuarded(() => _service.grocery(h));
    if (items != null) {
      _grocery = items;
      notifyListeners();
    }
  }

  Future<void> addGroceryItem(String name, {String? quantity}) async {
    final h = _householdId;
    if (h == null) return;
    await runGuarded(() async {
      await _service.addGroceryItem(h, name, quantity: quantity);
      await loadGrocery();
    });
  }

  Future<void> toggleGroceryItem(GroceryItem item) async {
    final h = _householdId;
    if (h == null) return;
    final updated = await runGuarded(
      () => _service.updateGroceryItem(h, item.id, {'isChecked': !item.isChecked}),
    );
    if (updated != null) {
      _grocery = _grocery.map((i) => i.id == updated.id ? updated : i).toList();
      notifyListeners();
    }
  }

  Future<void> removeGroceryItem(GroceryItem item) async {
    final h = _householdId;
    if (h == null) return;
    await runGuarded(() async {
      await _service.deleteGroceryItem(h, item.id);
      _grocery = _grocery.where((i) => i.id != item.id).toList();
      notifyListeners();
    });
  }

  static String _addDays(String ymd, int days) {
    final parts = ymd.split('-').map(int.parse).toList();
    final d = DateTime(parts[0], parts[1], parts[2]).add(Duration(days: days));
    return '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
  }
}
