// Meal-planning domain models mirroring the EP-0030 API.

const mealTypes = ['breakfast', 'lunch', 'dinner', 'snack'];
const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/// One meal assigned to a (day, meal-type) slot.
class MealEntry {
  final String id;
  final int dayOfWeek;
  final String mealType;
  final String mealName;
  final String? notes;

  const MealEntry({
    required this.id,
    required this.dayOfWeek,
    required this.mealType,
    required this.mealName,
    this.notes,
  });

  factory MealEntry.fromJson(Map<String, dynamic> json) => MealEntry(
        id: json['id'] as String,
        dayOfWeek: (json['dayOfWeek'] as num?)?.toInt() ?? 0,
        mealType: json['mealType'] as String? ?? 'dinner',
        mealName: json['mealName'] as String? ?? '',
        notes: json['notes'] as String?,
      );
}

/// A weekly meal plan with its entries.
class MealPlan {
  final String id;
  final String weekStartDate;
  final List<MealEntry> entries;

  const MealPlan({required this.id, required this.weekStartDate, this.entries = const []});

  /// Look up the entry for a (day, meal-type) slot, or null.
  MealEntry? entryFor(int day, String mealType) {
    for (final e in entries) {
      if (e.dayOfWeek == day && e.mealType == mealType) return e;
    }
    return null;
  }

  factory MealPlan.fromJson(Map<String, dynamic> json, {List<dynamic>? entries}) => MealPlan(
        id: json['id'] as String,
        weekStartDate: json['weekStartDate'] as String? ?? '',
        entries: (entries ?? const [])
            .map((e) => MealEntry.fromJson((e as Map).cast<String, dynamic>()))
            .toList(),
      );
}

/// A grocery checklist item.
class GroceryItem {
  final String id;
  final String name;
  final String? quantity;
  final bool isChecked;

  const GroceryItem({
    required this.id,
    required this.name,
    this.quantity,
    required this.isChecked,
  });

  factory GroceryItem.fromJson(Map<String, dynamic> json) => GroceryItem(
        id: json['id'] as String,
        name: json['name'] as String? ?? '',
        quantity: json['quantity'] as String?,
        isChecked: json['isChecked'] as bool? ?? false,
      );
}
