import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/constants.dart';
import '../../providers/auth_provider.dart';
import '../../providers/meal_provider.dart';
import '../../widgets/module_guard.dart';

/// Grocery checklist (EP-0030): add, check off, and remove items.
class GroceryScreen extends StatefulWidget {
  const GroceryScreen({super.key});

  @override
  State<GroceryScreen> createState() => _GroceryScreenState();
}

class _GroceryScreenState extends State<GroceryScreen> {
  final _controller = TextEditingController();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final auth = context.read<AuthProvider>();
      if (auth.householdId.isNotEmpty) {
        final provider = context.read<MealProvider>();
        if (provider.weekStart.isEmpty) {
          provider.loadWeek(
            auth.householdId,
            MealProvider.weekStartOf(DateTime.now()),
          );
        }
        provider.loadGrocery();
      }
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<MealProvider>();
    return Scaffold(
      appBar: AppBar(title: const Text('Grocery list')),
      body: ModuleGuard(
        module: AppModules.meals,
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.all(12),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _controller,
                      decoration: const InputDecoration(
                        labelText: 'Add item',
                        border: OutlineInputBorder(),
                      ),
                      onSubmitted: (_) => _add(),
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton.filled(
                    onPressed: _add,
                    icon: const Icon(Icons.add),
                  ),
                ],
              ),
            ),
            Expanded(
              child: provider.grocery.isEmpty
                  ? const Center(child: Text('No items'))
                  : ListView(
                      children: [
                        for (final item in provider.grocery)
                          CheckboxListTile(
                            value: item.isChecked,
                            onChanged: (_) => context
                                .read<MealProvider>()
                                .toggleGroceryItem(item),
                            title: Text(
                              item.quantity != null
                                  ? '${item.name} (${item.quantity})'
                                  : item.name,
                              style: item.isChecked
                                  ? const TextStyle(
                                      decoration: TextDecoration.lineThrough,
                                    )
                                  : null,
                            ),
                            secondary: IconButton(
                              tooltip: 'Delete',
                              icon: const Icon(Icons.delete_outline),
                              onPressed: () => context
                                  .read<MealProvider>()
                                  .removeGroceryItem(item),
                            ),
                          ),
                      ],
                    ),
            ),
          ],
        ),
      ),
    );
  }

  void _add() {
    final name = _controller.text.trim();
    if (name.isEmpty) return;
    context.read<MealProvider>().addGroceryItem(name);
    _controller.clear();
  }
}
