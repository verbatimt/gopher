// Recipe domain models mirroring the EP-0045 API. Ingredient quantities arrive as strings
// (Postgres numeric); kept as strings for display (optional).

class RecipeIngredient {
  final String id;
  final String name;
  final String? quantity;
  final String? unit;
  final String? note;
  final int sortOrder;

  const RecipeIngredient({
    required this.id,
    required this.name,
    this.quantity,
    this.unit,
    this.note,
    required this.sortOrder,
  });

  String get label {
    final q = quantity == null ? '' : _trim(quantity!);
    final u = unit ?? '';
    final qty = [q, u].where((s) => s.isNotEmpty).join(' ');
    return qty.isEmpty ? name : '$qty $name';
  }

  static String _trim(String n) {
    final d = double.tryParse(n);
    if (d == null) return n;
    return d == d.roundToDouble() ? d.toInt().toString() : d.toString();
  }

  factory RecipeIngredient.fromJson(Map<String, dynamic> json) => RecipeIngredient(
        id: json['id'] as String,
        name: json['name'] as String? ?? '',
        quantity: json['quantity']?.toString(),
        unit: json['unit'] as String?,
        note: json['note'] as String?,
        sortOrder: (json['sortOrder'] as num?)?.toInt() ?? 1,
      );
}

class RecipeStep {
  final String id;
  final int stepNumber;
  final String instruction;

  const RecipeStep({required this.id, required this.stepNumber, required this.instruction});

  factory RecipeStep.fromJson(Map<String, dynamic> json) => RecipeStep(
        id: json['id'] as String,
        stepNumber: (json['stepNumber'] as num?)?.toInt() ?? 1,
        instruction: json['instruction'] as String? ?? '',
      );
}

class Recipe {
  final String id;
  final String name;
  final String? description;
  final int servings;
  final int? prepMinutes;
  final int? cookMinutes;
  final String? source;
  final String? imagePath;
  final List<String> tags;
  // Optional per-recipe nutrition (ADR-0005). Grams arrive as numeric strings (Postgres numeric).
  final int? calories;
  final double? proteinGrams;
  final double? carbsGrams;
  final double? fatGrams;
  final bool isActive;

  const Recipe({
    required this.id,
    required this.name,
    this.description,
    required this.servings,
    this.prepMinutes,
    this.cookMinutes,
    this.source,
    this.imagePath,
    this.tags = const [],
    this.calories,
    this.proteinGrams,
    this.carbsGrams,
    this.fatGrams,
    this.isActive = true,
  });

  /// Whether any nutrition value is present (so the UI can hide the section entirely).
  bool get hasNutrition =>
      calories != null || proteinGrams != null || carbsGrams != null || fatGrams != null;

  static double? _toDouble(Object? v) =>
      v == null ? null : (v is num ? v.toDouble() : double.tryParse(v.toString()));

  factory Recipe.fromJson(Map<String, dynamic> json) => Recipe(
        id: json['id'] as String,
        name: json['name'] as String? ?? '',
        description: json['description'] as String?,
        servings: (json['servings'] as num?)?.toInt() ?? 1,
        prepMinutes: (json['prepMinutes'] as num?)?.toInt(),
        cookMinutes: (json['cookMinutes'] as num?)?.toInt(),
        source: json['source'] as String?,
        imagePath: json['imagePath'] as String?,
        tags: ((json['tags'] as List?) ?? const []).map((e) => e.toString()).toList(),
        calories: (json['calories'] as num?)?.toInt(),
        proteinGrams: _toDouble(json['proteinGrams']),
        carbsGrams: _toDouble(json['carbsGrams']),
        fatGrams: _toDouble(json['fatGrams']),
        isActive: json['isActive'] as bool? ?? true,
      );
}

/// A recipe with its ingredients and ordered steps (the detail endpoint shape).
class RecipeDetail {
  final Recipe recipe;
  final List<RecipeIngredient> ingredients;
  final List<RecipeStep> steps;

  const RecipeDetail({required this.recipe, this.ingredients = const [], this.steps = const []});

  factory RecipeDetail.fromJson(Map<String, dynamic> json) => RecipeDetail(
        recipe: Recipe.fromJson((json['recipe'] as Map).cast<String, dynamic>()),
        ingredients: ((json['ingredients'] as List?) ?? const [])
            .map((e) => RecipeIngredient.fromJson((e as Map).cast<String, dynamic>()))
            .toList(),
        steps: ((json['steps'] as List?) ?? const [])
            .map((e) => RecipeStep.fromJson((e as Map).cast<String, dynamic>()))
            .toList(),
      );
}
