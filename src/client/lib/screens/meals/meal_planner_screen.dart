import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../core/constants.dart';
import '../../models/meal.dart';
import '../../models/nutrition.dart';
import '../../providers/auth_provider.dart';
import '../../providers/household_provider.dart';
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
      context.read<HouseholdProvider>().load(auth.householdId);
    }
  }

  void _shiftWeek(int days) {
    setState(() => _week = _week.add(Duration(days: days)));
    _reload();
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<MealProvider>();
    // Per-day nutrition rolls up the week's recipe-linked entries (ADR-0005); the recipe list
    // is already loaded alongside the plan, so this is a cheap client-side aggregation.
    final recipesById = {for (final r in context.watch<RecipeProvider>().recipes) r.id: r};
    final totals = dailyTotals(provider.plan?.entries ?? const [], recipesById);
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
                children: [
                  for (var day = 0; day < 7; day++) _dayCard(context, provider, day, totals[day]),
                ],
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

  Widget _dayCard(BuildContext context, MealProvider provider, int day, NutritionTotals? total) {
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
            if (total != null && !total.isEmpty) _dayNutrition(context, total),
          ],
        ),
      ),
    );
  }

  Widget _dayNutrition(BuildContext context, NutritionTotals t) {
    final theme = Theme.of(context);
    String n(double v) => v.round().toString();
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 4, 8, 4),
      child: Row(
        children: [
          Icon(
            Icons.local_fire_department_outlined,
            size: 14,
            color: theme.colorScheme.onSurfaceVariant,
          ),
          const SizedBox(width: 4),
          Expanded(
            child: Text(
              '${n(t.calories)} kcal · ${n(t.protein)} g P · ${n(t.carbs)} g C · ${n(t.fat)} g F',
              style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
          ),
        ],
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
          if (entry != null && entry.isPersonal) ...[
            const SizedBox(width: 4),
            const Icon(Icons.person_outline, size: 14),
            const SizedBox(width: 2),
            Text(
              _memberName(context, entry.memberId),
              style: Theme.of(context).textTheme.labelSmall,
            ),
          ],
        ],
      ),
      trailing: const Icon(Icons.edit_outlined, size: 18),
      onTap: () => _editSlot(context, day, type, entry),
    );
  }

  String _memberName(BuildContext context, String? memberId) {
    if (memberId == null) return 'Personal';
    for (final m in context.watch<HouseholdProvider>().members) {
      if (m.id == memberId) return m.displayName;
    }
    return 'Personal';
  }

  Future<void> _editSlot(BuildContext context, int day, String type, MealEntry? entry) async {
    final recipes = context.read<RecipeProvider>().recipes;
    final members = context.read<HouseholdProvider>().members;
    final controller = TextEditingController(text: entry?.recipeId == null ? entry?.mealName ?? '' : '');
    var useRecipe = entry?.recipeId != null;
    String? recipeId = entry?.recipeId;
    var isPersonal = entry?.isPersonal ?? false;
    String? memberId = entry?.memberId;

    final result = await showDialog<_SlotResult>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setLocal) => AlertDialog(
          title: Text('${weekdayNames[day]} · $type'),
          content: SingleChildScrollView(
            child: Column(
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
                const SizedBox(height: 16),
                SegmentedButton<bool>(
                  segments: const [
                    ButtonSegment(value: false, label: Text('Family')),
                    ButtonSegment(value: true, label: Text('Personal')),
                  ],
                  selected: {isPersonal},
                  onSelectionChanged: (s) => setLocal(() => isPersonal = s.first),
                ),
                if (isPersonal) ...[
                  const SizedBox(height: 12),
                  DropdownButtonFormField<String>(
                    initialValue: members.any((m) => m.id == memberId) ? memberId : null,
                    isExpanded: true,
                    decoration: const InputDecoration(labelText: 'Member'),
                    items: [
                      for (final m in members)
                        DropdownMenuItem(value: m.id, child: Text(m.displayName)),
                    ],
                    onChanged: (v) => setLocal(() => memberId = v),
                  ),
                ],
              ],
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
            FilledButton(
              onPressed: () => Navigator.pop(
                ctx,
                _SlotResult(
                  useRecipe: useRecipe,
                  recipeId: recipeId,
                  mealName: controller.text.trim(),
                  scope: isPersonal ? 'personal' : 'family',
                  memberId: isPersonal ? memberId : null,
                ),
              ),
              child: const Text('Save'),
            ),
          ],
        ),
      ),
    );
    if (result == null || !context.mounted) return;
    if (result.scope == 'personal' && result.memberId == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Pick a member for a personal meal.')),
      );
      return;
    }
    final meals = context.read<MealProvider>();
    if (result.useRecipe) {
      if (result.recipeId == null) return;
      await meals.setEntry(day, type, '',
          recipeId: result.recipeId, scope: result.scope, memberId: result.memberId);
    } else {
      if (result.mealName.isEmpty) return;
      await meals.setEntry(day, type, result.mealName,
          scope: result.scope, memberId: result.memberId);
    }
  }
}

class _SlotResult {
  final bool useRecipe;
  final String? recipeId;
  final String mealName;
  final String scope;
  final String? memberId;

  const _SlotResult({
    required this.useRecipe,
    this.recipeId,
    required this.mealName,
    required this.scope,
    this.memberId,
  });
}
