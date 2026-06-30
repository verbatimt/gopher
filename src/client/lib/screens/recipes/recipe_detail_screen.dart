import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../models/auth_state.dart';
import '../../providers/auth_provider.dart';
import '../../providers/recipe_provider.dart';

/// Recipe detail (EP-0047): metadata, an ingredient editor and a step editor (add / delete /
/// drag-reorder, dense 1..n), plus edit/delete recipe actions — all role-gated.
class RecipeDetailScreen extends StatefulWidget {
  final String recipeId;

  const RecipeDetailScreen({super.key, required this.recipeId});

  @override
  State<RecipeDetailScreen> createState() => _RecipeDetailScreenState();
}

class _RecipeDetailScreenState extends State<RecipeDetailScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final auth = context.read<AuthProvider>();
      context.read<RecipeProvider>().openFor(auth.householdId, widget.recipeId);
    });
  }

  bool _canAuthor(AuthProvider auth) =>
      auth.roles.contains(RoleNames.supervising) || auth.roles.contains(RoleNames.unsupervised);

  Future<void> _addIngredient() async {
    final name = TextEditingController();
    final qty = TextEditingController();
    final unit = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Add ingredient'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(controller: name, decoration: const InputDecoration(labelText: 'Name')),
            TextField(
              controller: qty,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(labelText: 'Quantity'),
            ),
            TextField(controller: unit, decoration: const InputDecoration(labelText: 'Unit')),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Add')),
        ],
      ),
    );
    if (ok != true || !mounted || name.text.trim().isEmpty) return;
    await context.read<RecipeProvider>().addIngredient(widget.recipeId, {
      'name': name.text.trim(),
      if (qty.text.trim().isNotEmpty) 'quantity': double.tryParse(qty.text.trim()),
      if (unit.text.trim().isNotEmpty) 'unit': unit.text.trim(),
    });
  }

  Future<void> _addStep() async {
    final instruction = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Add step'),
        content: TextField(
          controller: instruction,
          maxLines: 3,
          decoration: const InputDecoration(labelText: 'Instruction'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Add')),
        ],
      ),
    );
    if (ok != true || !mounted || instruction.text.trim().isEmpty) return;
    await context.read<RecipeProvider>().addStep(widget.recipeId, instruction.text.trim());
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final provider = context.watch<RecipeProvider>();
    final detail = provider.current;
    final canAuthor = _canAuthor(auth);

    if (detail == null || detail.recipe.id != widget.recipeId) {
      return Scaffold(
        appBar: AppBar(title: const Text('Recipe')),
        body: const Center(child: CircularProgressIndicator()),
      );
    }
    final r = detail.recipe;

    return Scaffold(
      appBar: AppBar(
        title: Text(r.name),
        actions: canAuthor
            ? [
                IconButton(
                  tooltip: 'Edit',
                  icon: const Icon(Icons.edit_outlined),
                  onPressed: () async {
                    final p = context.read<RecipeProvider>();
                    await context.push('/recipes/${r.id}/edit', extra: r);
                    if (mounted) p.open(widget.recipeId);
                  },
                ),
                IconButton(
                  tooltip: 'Delete',
                  icon: const Icon(Icons.delete_outline),
                  onPressed: () async {
                    final p = context.read<RecipeProvider>();
                    final ok = await p.remove(r.id);
                    if (!context.mounted) return;
                    if (ok) context.pop();
                  },
                ),
              ]
            : null,
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (r.description != null && r.description!.isNotEmpty) ...[
            Text(r.description!, style: Theme.of(context).textTheme.bodyMedium),
            const SizedBox(height: 12),
          ],
          Text(
            '${r.servings} serving${r.servings == 1 ? '' : 's'}'
            '${r.prepMinutes != null ? ' · prep ${r.prepMinutes}m' : ''}'
            '${r.cookMinutes != null ? ' · cook ${r.cookMinutes}m' : ''}',
            style: Theme.of(context).textTheme.labelLarge,
          ),
          if (r.tags.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Wrap(spacing: 6, children: [for (final t in r.tags) Chip(label: Text(t))]),
            ),
          const Divider(height: 32),
          _SectionTitle('Ingredients', onAdd: canAuthor ? _addIngredient : null),
          if (detail.ingredients.isEmpty)
            const Padding(padding: EdgeInsets.all(8), child: Text('No ingredients yet.'))
          else
            ReorderableListView(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              buildDefaultDragHandles: canAuthor,
              onReorderItem: (oldI, newI) {
                final ids = detail.ingredients.map((i) => i.id).toList();
                final moved = ids.removeAt(oldI);
                ids.insert(newI, moved);
                context.read<RecipeProvider>().reorderIngredients(widget.recipeId, ids);
              },
              children: [
                for (final ing in detail.ingredients)
                  ListTile(
                    key: ValueKey(ing.id),
                    title: Text(ing.label),
                    subtitle: ing.note != null ? Text(ing.note!) : null,
                    trailing: canAuthor
                        ? IconButton(
                            icon: const Icon(Icons.remove_circle_outline),
                            onPressed: () => context
                                .read<RecipeProvider>()
                                .deleteIngredient(widget.recipeId, ing.id),
                          )
                        : null,
                  ),
              ],
            ),
          const Divider(height: 32),
          _SectionTitle('Steps', onAdd: canAuthor ? _addStep : null),
          if (detail.steps.isEmpty)
            const Padding(padding: EdgeInsets.all(8), child: Text('No steps yet.'))
          else
            ReorderableListView(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              buildDefaultDragHandles: canAuthor,
              onReorderItem: (oldI, newI) {
                final ids = detail.steps.map((s) => s.id).toList();
                final moved = ids.removeAt(oldI);
                ids.insert(newI, moved);
                context.read<RecipeProvider>().reorderSteps(widget.recipeId, ids);
              },
              children: [
                for (final st in detail.steps)
                  ListTile(
                    key: ValueKey(st.id),
                    leading: CircleAvatar(radius: 14, child: Text('${st.stepNumber}')),
                    title: Text(st.instruction),
                    trailing: canAuthor
                        ? IconButton(
                            icon: const Icon(Icons.remove_circle_outline),
                            onPressed: () =>
                                context.read<RecipeProvider>().deleteStep(widget.recipeId, st.id),
                          )
                        : null,
                  ),
              ],
            ),
        ],
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  final String title;
  final VoidCallback? onAdd;

  const _SectionTitle(this.title, {this.onAdd});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(title, style: Theme.of(context).textTheme.titleMedium),
        if (onAdd != null) IconButton(icon: const Icon(Icons.add), onPressed: onAdd),
      ],
    );
  }
}
