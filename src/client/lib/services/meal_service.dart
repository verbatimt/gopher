import '../core/api/api_client.dart';
import '../models/meal.dart';

/// Transport for the meals API (EP-0030).
class MealService {
  final ApiClient _api;

  MealService(this._api);

  String _base(String householdId) => '/api/v1/households/$householdId';

  Future<List<MealPlan>> listPlans(String householdId, {String? weekStart}) {
    final q = weekStart != null ? '?weekStart=$weekStart' : '';
    return _api.getEnveloped('${_base(householdId)}/meal-plans$q', (r) {
      final list = (r as Map)['plans'] as List;
      return list.map((e) => MealPlan.fromJson((e as Map).cast<String, dynamic>())).toList();
    });
  }

  Future<MealPlan> getPlan(String householdId, String planId) {
    return _api.getEnveloped('${_base(householdId)}/meal-plans/$planId', (r) {
      final map = (r as Map).cast<String, dynamic>();
      return MealPlan.fromJson(
        (map['plan'] as Map).cast<String, dynamic>(),
        entries: map['entries'] as List?,
      );
    });
  }

  Future<MealPlan> createPlan(String householdId, String weekStartDate) {
    return _api.postEnveloped(
      '${_base(householdId)}/meal-plans',
      {'weekStartDate': weekStartDate},
      (r) => MealPlan.fromJson(((r as Map)['plan'] as Map).cast<String, dynamic>()),
    );
  }

  Future<void> upsertEntry(String householdId, String planId, Map<String, dynamic> body) async {
    await _api.postEnveloped('${_base(householdId)}/meal-plans/$planId/entries', body, (_) => null);
  }

  Future<void> deleteEntry(String householdId, String planId, String entryId) async {
    await _api.deleteEnveloped(
      '${_base(householdId)}/meal-plans/$planId/entries/$entryId',
      (_) => null,
    );
  }

  Future<MealPlan> copyPlan(String householdId, String planId, String targetWeekStart) {
    return _api.postEnveloped(
      '${_base(householdId)}/meal-plans/$planId/copy',
      {'targetWeekStart': targetWeekStart},
      (r) => MealPlan.fromJson(((r as Map)['plan'] as Map).cast<String, dynamic>()),
    );
  }

  Future<List<GroceryItem>> grocery(String householdId) {
    return _api.getEnveloped('${_base(householdId)}/grocery', (r) {
      final list = (r as Map)['items'] as List;
      return list.map((e) => GroceryItem.fromJson((e as Map).cast<String, dynamic>())).toList();
    });
  }

  Future<void> addGroceryItem(String householdId, String name, {String? quantity}) async {
    await _api.postEnveloped(
      '${_base(householdId)}/grocery/items',
      {'name': name, 'quantity': ?quantity},
      (_) => null,
    );
  }

  Future<GroceryItem> updateGroceryItem(
    String householdId,
    String itemId,
    Map<String, dynamic> body,
  ) {
    return _api.patchEnveloped(
      '${_base(householdId)}/grocery/items/$itemId',
      body,
      (r) => GroceryItem.fromJson(((r as Map)['item'] as Map).cast<String, dynamic>()),
    );
  }

  Future<void> deleteGroceryItem(String householdId, String itemId) async {
    await _api.deleteEnveloped('${_base(householdId)}/grocery/items/$itemId', (_) => null);
  }

  /// EP-0046: derive grocery items from a plan's recipe-linked entries; returns {added, merged}.
  Future<Map<String, int>> seedFromPlanIngredients(String householdId, String planId) {
    return _api.postEnveloped('${_base(householdId)}/grocery/seed-from-plan', {'planId': planId}, (r) {
      final map = (r as Map).cast<String, dynamic>();
      return {
        'added': (map['added'] as num?)?.toInt() ?? 0,
        'merged': (map['merged'] as num?)?.toInt() ?? 0,
      };
    });
  }
}
