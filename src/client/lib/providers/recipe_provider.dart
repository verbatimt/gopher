import '../models/recipe.dart';
import '../services/recipe_service.dart';
import 'base_provider.dart';

/// Recipe book state (EP-0047): the searchable recipe list plus the currently open recipe
/// detail. Authoring actions optimistically refresh the affected recipe.
class RecipeProvider extends BaseProvider {
  final RecipeService _service;

  String? _householdId;
  List<Recipe> _recipes = [];
  RecipeDetail? _current;

  RecipeProvider(this._service);

  List<Recipe> get recipes => List.unmodifiable(_recipes);
  RecipeDetail? get current => _current;

  Future<void> load(String householdId, {String? search, String? tag}) async {
    _householdId = householdId;
    final result = await runGuarded(() => _service.listRecipes(householdId, search: search, tag: tag));
    if (result != null) {
      _recipes = result;
      notifyListeners();
    }
  }

  Future<RecipeDetail?> open(String recipeId) async {
    final h = _householdId;
    if (h == null) return null;
    final detail = await runGuarded(() => _service.getRecipe(h, recipeId));
    if (detail != null) {
      _current = detail;
      notifyListeners();
    }
    return detail;
  }

  /// Open a recipe, establishing the household context first (so the detail screen works even
  /// when reached directly without a prior list load).
  Future<RecipeDetail?> openFor(String householdId, String recipeId) {
    _householdId = householdId;
    return open(recipeId);
  }

  Future<RecipeDetail?> create(Map<String, dynamic> body) async {
    final h = _householdId;
    if (h == null) return null;
    final created = await runGuarded(() => _service.createRecipe(h, body));
    if (created != null) {
      _current = created;
      await load(h);
    }
    return created;
  }

  Future<bool> update(String recipeId, Map<String, dynamic> body) async {
    final h = _householdId;
    if (h == null) return false;
    final updated = await runGuarded(() => _service.updateRecipe(h, recipeId, body));
    if (updated == null) return false;
    _current = updated;
    await load(h);
    return true;
  }

  Future<bool> remove(String recipeId) async {
    final h = _householdId;
    if (h == null) return false;
    final ok = await runGuarded(() async {
      await _service.deleteRecipe(h, recipeId);
      return true;
    });
    if (ok != true) return false;
    _recipes = _recipes.where((r) => r.id != recipeId).toList();
    notifyListeners();
    return true;
  }

  Future<bool> addIngredient(String recipeId, Map<String, dynamic> body) async {
    final h = _householdId;
    if (h == null) return false;
    final added = await runGuarded(() => _service.addIngredient(h, recipeId, body));
    if (added == null) return false;
    await open(recipeId);
    return true;
  }

  Future<bool> deleteIngredient(String recipeId, String ingredientId) async {
    final h = _householdId;
    if (h == null) return false;
    final ok = await runGuarded(() async {
      await _service.deleteIngredient(h, recipeId, ingredientId);
      return true;
    });
    if (ok != true) return false;
    await open(recipeId);
    return true;
  }

  Future<bool> reorderIngredients(String recipeId, List<String> order) async {
    final h = _householdId;
    if (h == null) return false;
    final detail = await runGuarded(() => _service.reorderIngredients(h, recipeId, order));
    if (detail == null) return false;
    _current = detail;
    notifyListeners();
    return true;
  }

  Future<bool> addStep(String recipeId, String instruction) async {
    final h = _householdId;
    if (h == null) return false;
    final added = await runGuarded(() => _service.addStep(h, recipeId, {'instruction': instruction}));
    if (added == null) return false;
    await open(recipeId);
    return true;
  }

  Future<bool> deleteStep(String recipeId, String stepId) async {
    final h = _householdId;
    if (h == null) return false;
    final ok = await runGuarded(() async {
      await _service.deleteStep(h, recipeId, stepId);
      return true;
    });
    if (ok != true) return false;
    await open(recipeId);
    return true;
  }

  Future<bool> reorderSteps(String recipeId, List<String> order) async {
    final h = _householdId;
    if (h == null) return false;
    final detail = await runGuarded(() => _service.reorderSteps(h, recipeId, order));
    if (detail == null) return false;
    _current = detail;
    notifyListeners();
    return true;
  }
}
