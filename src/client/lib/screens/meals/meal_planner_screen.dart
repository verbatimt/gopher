import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../core/constants.dart';
import '../../models/meal.dart';
import '../../providers/auth_provider.dart';
import '../../providers/meal_provider.dart';
import '../../widgets/module_guard.dart';
import '../../widgets/notification_bell.dart';

/// Weekly meal planner (EP-0030): a day × meal-type grid with tappable cells, a copy-to-next-
/// week action, and a link to the grocery list. Plans are created lazily on first edit.
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
                  for (var day = 0; day < 7; day++)
                    _dayCard(context, provider, day),
                ],
              ),
            ),
          ],
        ),
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
          Expanded(
            child: Text('Week of $_weekStart', textAlign: TextAlign.center),
          ),
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
                    final ok = await context
                        .read<MealProvider>()
                        .copyToNextWeek();
                    if (context.mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content: Text(
                            ok
                                ? 'Copied to next week'
                                : 'Next week already planned',
                          ),
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
              child: Text(
                weekdayNames[day],
                style: Theme.of(context).textTheme.titleMedium,
              ),
            ),
            for (final type in mealTypes) _slot(context, provider, day, type),
          ],
        ),
      ),
    );
  }

  Widget _slot(
    BuildContext context,
    MealProvider provider,
    int day,
    String type,
  ) {
    final entry = provider.plan?.entryFor(day, type);
    return ListTile(
      dense: true,
      title: Text(type[0].toUpperCase() + type.substring(1)),
      subtitle: Text(entry?.mealName ?? '—'),
      trailing: const Icon(Icons.edit_outlined, size: 18),
      onTap: () => _editSlot(context, day, type, entry?.mealName ?? ''),
    );
  }

  Future<void> _editSlot(
    BuildContext context,
    int day,
    String type,
    String current,
  ) async {
    final controller = TextEditingController(text: current);
    final name = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('${weekdayNames[day]} · $type'),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(labelText: 'Meal'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, controller.text.trim()),
            child: const Text('Save'),
          ),
        ],
      ),
    );
    if (name == null || name.isEmpty || !context.mounted) return;
    await context.read<MealProvider>().setEntry(day, type, name);
  }
}
