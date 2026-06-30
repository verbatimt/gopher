import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../core/constants.dart';
import '../../models/meal.dart';
import '../../providers/auth_provider.dart';
import '../../providers/meal_provider.dart';
import '../../providers/recipe_provider.dart';
import '../../widgets/module_guard.dart';
import '../../widgets/notification_bell.dart';

/// Weekly meal planner (EP-0030 + EP-0046): a day × meal-type grid; each slot can be free text
/// or a linked recipe, and a week's recipe ingredients can be pushed to the grocery list.
class MealPlannerScreen extends StatefulWidget {
  const MealPlannerScreen({super.key});

  @override
  State<MealPlannerScreen> createState() => _MealPlannerScreenState();
}

class _MealPlannerScreenState extends State<MealPlannerScreen> {
  DateTime _week = DateTime.now();

  String get _weekStart => MealProvider.weekStartOf(_week);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _reload());
  }

  void _reload() {
    final auth = context.read<AuthProvider>();
    if (auth.householdId.isNotEmpty) {
      context.read<MealProvider>().loadWeek(auth.householdId, _weekStart);
      context.read<RecipeProvider>().load(auth.householdId);
    }
  }

  void _shiftWeek(int days) {
    setState(() => _week = _week.add(Duration(days: days)));
    _reload();
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<MealProvider>();
    return Scaffold(
      appBar: AppBar(
        title: const Text('Meals'),
        actions: [
          IconButton(
            tooltip: 'Add recipe ingredients to grocery',
            icon: const Icon(Icons.playlist_add),
            onPressed: provider.plan == null ? null : _addIngredientsToGrocery,
          ),
          IconButton(
            tooltip: 'Grocery list',
            icon: const Icon(Icons.shopping_cart_outlined),
            onPressed: () => context.push('/grocery'),
          ),
          const NotificationBell(),
        ],
      ),
      body: ModuleGuard(
        module: AppModules.meals,
        child: Column(
          children: [
            _weekBar(context, provider),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.all(8),
                children: [for (var day = 0; day < 7; day++) _dayCard(context, provider, day)],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _addIngredientsToGrocery() async {
    final meals = context.read<MealProvider>();
    final result = await meals.addPlanIngredientsToGrocery();
    if (!mounted) return;
    final added = result?['added'] ?? 0;
    final merged = result?['merged'] ?? 0;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          result == null
              ? (meals.error ?? 'Could not derive grocery items.')
              : 'Grocery updated: $added added, $merged merged.',
        ),
        action: SnackBarAction(label: 'View', onPressed: () => context.push('/grocery')),
      ),
    );
  }

  Widget _weekBar(BuildContext context, MealProvider provider) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      child: Row(
        children: [
          IconButton(
            tooltip: 'Previous week',
            icon: const Icon(Icons.chevron_left),
            onPressed: () => _shiftWeek(-7),
          ),
          Expanded(child: Text('Week of $_weekStart', textAlign: TextAlign.center)),
          IconButton(
            tooltip: 'Next week',
            icon: const Icon(Icons.chevron_right),
            onPressed: () => _shiftWeek(7),
          ),
          TextButton.icon(
            icon: const Icon(Icons.copy_all),
            label: const Text('Copy →'),
            onPressed: provider.plan == null
                ? null
                : () async {
                    final ok = await context.read<MealProvider>().copyToNextWeek();
                    if (context.mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content: Text(ok ? 'Copied to next week' : 'Next week already planned'),
                        ),
                      );
                    }
                  },
          ),
        ],
      ),
    );
  }

  Widget _dayCard(BuildContext context, MealProvider provider, int day) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              child: Text(weekdayNames[day], style: Theme.of(context).textTheme.titleMedium),
            ),
            for (final type in mealTypes) _slot(context, provider, day, type),
          ],
        ),
      ),
    );
  }

  Widget _slot(BuildContext context, MealProvider provider, int day, String type) {
    final entry = provider.plan?.entryFor(day, type);
    return ListTile(
      dense: true,
      title: Text(type[0].toUpperCase() + type.substring(1)),
      subtitle: Row(
        children: [
          if (entry?.recipeId != null) ...[
            const Icon(Icons.restaurant_menu, size: 14),
            const SizedBox(width: 4),
          ],
          Expanded(child: Text(entry?.mealName ?? '—')),
        ],
      ),
      trailing: const Icon(Icons.edit_outlined, size: 18),
      onTap: () => _editSlot(context, day, type, entry),
    );
  }

  Future<void> _editSlot(BuildContext context, int day, String type, MealEntry? entry) async {
    final recipes = context.read<RecipeProvider>().recipes;
    final controller = TextEditingController(text: entry?.recipeId == null ? entry?.mealName ?? '' : '');
    var useRecipe = entry?.recipeId != null;
    String? recipeId = entry?.recipeId;

    final result = await showDialog<_SlotResult>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setLocal) => AlertDialog(
          title: Text('${weekdayNames[day]} · $type'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              SegmentedButton<bool>(
                segments: const [
                  ButtonSegment(value: false, label: Text('Free text')),
                  ButtonSegment(value: true, label: Text('Recipe')),
                ],
                selected: {useRecipe},
                onSelectionChanged: (s) => setLocal(() => useRecipe = s.first),
              ),
              const SizedBox(height: 12),
              if (useRecipe)
                DropdownButtonFormField<String>(
                  initialValue: recipeId,
                  isExpanded: true,
                  decoration: const InputDecoration(labelText: 'Recipe'),
                  items: [
                    for (final r in recipes) DropdownMenuItem(value: r.id, child: Text(r.name)),
                  ],
                  onChanged: (v) => setLocal(() => recipeId = v),
                )
              else
                TextField(
                  controller: controller,
                  autofocus: true,
                  decoration: const InputDecoration(labelText: 'Meal'),
                ),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
            FilledButton(
              onPressed: () => Navigator.pop(
                ctx,
                _SlotResult(useRecipe: useRecipe, recipeId: recipeId, mealName: controller.text.trim()),
              ),
              child: const Text('Save'),
            ),
          ],
        ),
      ),
    );
    if (result == null || !context.mounted) return;
    if (result.useRecipe) {
      if (result.recipeId == null) return;
      await context.read<MealProvider>().setEntry(day, type, '', recipeId: result.recipeId);
    } else {
      if (result.mealName.isEmpty) return;
      await context.read<MealProvider>().setEntry(day, type, result.mealName);
    }
  }
}

class _SlotResult {
  final bool useRecipe;
  final String? recipeId;
  final String mealName;

  const _SlotResult({required this.useRecipe, this.recipeId, required this.mealName});
}
