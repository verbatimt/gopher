import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../core/constants.dart';
import '../../models/auth_state.dart';
import '../../models/recipe.dart';
import '../../providers/auth_provider.dart';
import '../../providers/recipe_provider.dart';
import '../../widgets/empty_state.dart';
import '../../widgets/list_detail_layout.dart';
import '../../widgets/module_guard.dart';
import '../../widgets/remote_image.dart';
import 'recipe_detail_screen.dart';

/// Browse + search the household recipe book (EP-0047). Authoring (FAB) is shown only to
/// supervising/unsupervised members (meals:write); supervised members are read-only.
///
/// On expanded windows this uses the canonical M3 list-detail layout: the recipe list on the
/// leading edge and the selected recipe's detail in the trailing pane. On compact/medium it
/// stays single-pane and opens the detail as a full-screen route.
class RecipeListScreen extends StatefulWidget {
  const RecipeListScreen({super.key});

  @override
  State<RecipeListScreen> createState() => _RecipeListScreenState();
}

class _RecipeListScreenState extends State<RecipeListScreen> {
  final _search = TextEditingController();
  String? _selectedId;

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

  void _openRecipe(String id, bool isTwoPane) {
    if (isTwoPane) {
      setState(() => _selectedId = id);
    } else {
      context.push('/recipes/$id');
    }
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
        child: ListDetailLayout(
          listBuilder: (context, isTwoPane) => _buildList(provider, auth, isTwoPane),
          detail: _selectedId == null
              ? null
              : RecipeDetailView(
                  key: ValueKey(_selectedId),
                  recipeId: _selectedId!,
                  showHeader: true,
                  onDeleted: () {
                    if (mounted) setState(() => _selectedId = null);
                  },
                ),
          placeholder: const DetailPanePlaceholder(
            message: 'Select a recipe to see its ingredients and steps.',
          ),
        ),
      ),
    );
  }

  Widget _buildList(RecipeProvider provider, AuthProvider auth, bool isTwoPane) {
    return Column(
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
                    children: [
                      for (final r in provider.recipes)
                        _RecipeTile(
                          recipe: r,
                          selected: isTwoPane && r.id == _selectedId,
                          onTap: () => _openRecipe(r.id, isTwoPane),
                        ),
                    ],
                  ),
                ),
        ),
      ],
    );
  }
}

class _RecipeTile extends StatelessWidget {
  final Recipe recipe;
  final bool selected;
  final VoidCallback onTap;

  const _RecipeTile({required this.recipe, required this.selected, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final meta = <String>[
      '${recipe.servings} serving${recipe.servings == 1 ? '' : 's'}',
      if (recipe.prepMinutes != null) 'prep ${recipe.prepMinutes}m',
      if (recipe.cookMinutes != null) 'cook ${recipe.cookMinutes}m',
    ].join(' · ');
    return ListTile(
      selected: selected,
      leading: RemoteImage(
        path: recipe.imagePath,
        height: 48,
        width: 48,
        radius: 6,
        placeholderIcon: Icons.restaurant_menu,
      ),
      title: Text(recipe.name),
      subtitle: Text([meta, if (recipe.tags.isNotEmpty) recipe.tags.join(', ')].join('\n')),
      isThreeLine: recipe.tags.isNotEmpty,
      onTap: onTap,
    );
  }
}
