import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../core/constants.dart';
import '../../models/auth_state.dart';
import '../../models/recipe.dart';
import '../../providers/auth_provider.dart';
import '../../providers/recipe_provider.dart';
import '../../widgets/empty_state.dart';
import '../../widgets/module_guard.dart';

/// Browse + search the household recipe book (EP-0047). Authoring (FAB) is shown only to
/// supervising/unsupervised members (meals:write); supervised members are read-only.
class RecipeListScreen extends StatefulWidget {
  const RecipeListScreen({super.key});

  @override
  State<RecipeListScreen> createState() => _RecipeListScreenState();
}

class _RecipeListScreenState extends State<RecipeListScreen> {
  final _search = TextEditingController();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final auth = context.read<AuthProvider>();
      if (auth.householdId.isNotEmpty) context.read<RecipeProvider>().load(auth.householdId);
    });
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  void _runSearch() {
    final auth = context.read<AuthProvider>();
    context.read<RecipeProvider>().load(auth.householdId, search: _search.text.trim());
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final provider = context.watch<RecipeProvider>();
    final canAuthor =
        auth.roles.contains(RoleNames.supervising) || auth.roles.contains(RoleNames.unsupervised);

    return Scaffold(
      appBar: AppBar(title: const Text('Recipes')),
      floatingActionButton: canAuthor
          ? FloatingActionButton.extended(
              onPressed: () async {
                final provider = context.read<RecipeProvider>();
                final hh = auth.householdId;
                await context.push('/recipes/new');
                if (!mounted) return;
                provider.load(hh);
              },
              icon: const Icon(Icons.add),
              label: const Text('New recipe'),
            )
          : null,
      body: ModuleGuard(
        module: AppModules.meals,
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.all(12),
              child: TextField(
                controller: _search,
                decoration: InputDecoration(
                  hintText: 'Search recipes',
                  border: const OutlineInputBorder(),
                  prefixIcon: const Icon(Icons.search),
                  suffixIcon: IconButton(icon: const Icon(Icons.arrow_forward), onPressed: _runSearch),
                ),
                onSubmitted: (_) => _runSearch(),
              ),
            ),
            Expanded(
              child: provider.recipes.isEmpty
                  ? const EmptyState(
                      icon: Icons.menu_book_outlined,
                      title: 'No recipes',
                      message: 'Add a recipe to start your household cookbook.',
                    )
                  : RefreshIndicator(
                      onRefresh: () => provider.load(auth.householdId, search: _search.text.trim()),
                      child: ListView(
                        children: [for (final r in provider.recipes) _RecipeTile(recipe: r)],
                      ),
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

class _RecipeTile extends StatelessWidget {
  final Recipe recipe;

  const _RecipeTile({required this.recipe});

  @override
  Widget build(BuildContext context) {
    final meta = <String>[
      '${recipe.servings} serving${recipe.servings == 1 ? '' : 's'}',
      if (recipe.prepMinutes != null) 'prep ${recipe.prepMinutes}m',
      if (recipe.cookMinutes != null) 'cook ${recipe.cookMinutes}m',
    ].join(' · ');
    return ListTile(
      leading: const Icon(Icons.restaurant_menu),
      title: Text(recipe.name),
      subtitle: Text([meta, if (recipe.tags.isNotEmpty) recipe.tags.join(', ')].join('\n')),
      isThreeLine: recipe.tags.isNotEmpty,
      onTap: () => context.push('/recipes/${recipe.id}'),
    );
  }
}
