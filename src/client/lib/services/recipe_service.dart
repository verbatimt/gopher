import '../core/api/api_client.dart';
import '../models/recipe.dart';

/// Transport for the recipes API (EP-0045). Mirrors the server routes under
/// `/api/v1/households/:id/recipes`.
class RecipeService {
  final ApiClient _api;

  RecipeService(this._api);

  String _base(String householdId) => '/api/v1/households/$householdId/recipes';

  Future<List<Recipe>> listRecipes(String householdId, {String? search, String? tag}) {
    final params = <String>[];
    if (search != null && search.isNotEmpty) params.add('search=${Uri.encodeQueryComponent(search)}');
    if (tag != null && tag.isNotEmpty) params.add('tag=${Uri.encodeQueryComponent(tag)}');
    final query = params.isEmpty ? '' : '?${params.join('&')}';
    return _api.getEnveloped('${_base(householdId)}$query', (r) {
      final list = (r as Map)['recipes'] as List;
      return list.map((e) => Recipe.fromJson((e as Map).cast<String, dynamic>())).toList();
    });
  }

  Future<RecipeDetail> getRecipe(String householdId, String recipeId) {
    return _api.getEnveloped(
      '${_base(householdId)}/$recipeId',
      (r) => RecipeDetail.fromJson((r as Map).cast<String, dynamic>()),
    );
  }

  Future<RecipeDetail> createRecipe(String householdId, Map<String, dynamic> body) {
    return _api.postEnveloped(
      _base(householdId),
      body,
      (r) => RecipeDetail.fromJson((r as Map).cast<String, dynamic>()),
    );
  }

  Future<RecipeDetail> updateRecipe(String householdId, String recipeId, Map<String, dynamic> body) {
    return _api.patchEnveloped(
      '${_base(householdId)}/$recipeId',
      body,
      (r) => RecipeDetail.fromJson((r as Map).cast<String, dynamic>()),
    );
  }

  Future<void> deleteRecipe(String householdId, String recipeId) {
    return _api.deleteEnveloped('${_base(householdId)}/$recipeId', (_) {});
  }

  Future<RecipeIngredient> addIngredient(
    String householdId,
    String recipeId,
    Map<String, dynamic> body,
  ) {
    return _api.postEnveloped(
      '${_base(householdId)}/$recipeId/ingredients',
      body,
      (r) => RecipeIngredient.fromJson(((r as Map)['ingredient'] as Map).cast<String, dynamic>()),
    );
  }

  Future<void> deleteIngredient(String householdId, String recipeId, String ingredientId) {
    return _api.deleteEnveloped(
      '${_base(householdId)}/$recipeId/ingredients/$ingredientId',
      (_) {},
    );
  }

  Future<RecipeDetail> reorderIngredients(String householdId, String recipeId, List<String> order) {
    return _api.postEnveloped(
      '${_base(householdId)}/$recipeId/ingredients/reorder',
      {'order': order},
      (r) => RecipeDetail.fromJson((r as Map).cast<String, dynamic>()),
    );
  }

  Future<RecipeStep> addStep(String householdId, String recipeId, Map<String, dynamic> body) {
    return _api.postEnveloped(
      '${_base(householdId)}/$recipeId/steps',
      body,
      (r) => RecipeStep.fromJson(((r as Map)['step'] as Map).cast<String, dynamic>()),
    );
  }

  Future<void> deleteStep(String householdId, String recipeId, String stepId) {
    return _api.deleteEnveloped('${_base(householdId)}/$recipeId/steps/$stepId', (_) {});
  }

  Future<RecipeDetail> reorderSteps(String householdId, String recipeId, List<String> order) {
    return _api.postEnveloped(
      '${_base(householdId)}/$recipeId/steps/reorder',
      {'order': order},
      (r) => RecipeDetail.fromJson((r as Map).cast<String, dynamic>()),
    );
  }
}
