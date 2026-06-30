import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../core/validators.dart';
import '../../models/recipe.dart';
import '../../providers/recipe_provider.dart';

/// Create a recipe (with inline ingredient/step rows) or edit an existing recipe's metadata.
/// Ingredient/step reordering for an existing recipe lives in the detail screen (EP-0047).
class RecipeFormScreen extends StatefulWidget {
  final Recipe? existing;

  const RecipeFormScreen({super.key, this.existing});

  @override
  State<RecipeFormScreen> createState() => _RecipeFormScreenState();
}

class _IngredientRow {
  final TextEditingController name = TextEditingController();
  final TextEditingController quantity = TextEditingController();
  final TextEditingController unit = TextEditingController();
  void dispose() {
    name.dispose();
    quantity.dispose();
    unit.dispose();
  }
}

class _RecipeFormScreenState extends State<RecipeFormScreen> {
  final _formKey = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _description = TextEditingController();
  final _servings = TextEditingController(text: '1');
  final _prep = TextEditingController();
  final _cook = TextEditingController();
  final _tags = TextEditingController();
  final _image = TextEditingController();
  final _calories = TextEditingController();
  final _protein = TextEditingController();
  final _carbs = TextEditingController();
  final _fat = TextEditingController();
  final List<_IngredientRow> _ingredients = [];
  final List<TextEditingController> _steps = [];
  bool _busy = false;

  bool get _isEdit => widget.existing != null;

  @override
  void initState() {
    super.initState();
    final e = widget.existing;
    if (e != null) {
      _name.text = e.name;
      _description.text = e.description ?? '';
      _servings.text = '${e.servings}';
      if (e.prepMinutes != null) _prep.text = '${e.prepMinutes}';
      if (e.cookMinutes != null) _cook.text = '${e.cookMinutes}';
      _tags.text = e.tags.join(', ');
      _image.text = e.imagePath ?? '';
      if (e.calories != null) _calories.text = '${e.calories}';
      if (e.proteinGrams != null) _protein.text = _trimNum(e.proteinGrams!);
      if (e.carbsGrams != null) _carbs.text = _trimNum(e.carbsGrams!);
      if (e.fatGrams != null) _fat.text = _trimNum(e.fatGrams!);
    } else {
      _ingredients.add(_IngredientRow());
      _steps.add(TextEditingController());
    }
  }

  @override
  void dispose() {
    _name.dispose();
    _description.dispose();
    _servings.dispose();
    _prep.dispose();
    _cook.dispose();
    _tags.dispose();
    _image.dispose();
    _calories.dispose();
    _protein.dispose();
    _carbs.dispose();
    _fat.dispose();
    for (final i in _ingredients) {
      i.dispose();
    }
    for (final s in _steps) {
      s.dispose();
    }
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _busy = true);
    final provider = context.read<RecipeProvider>();
    final tags = _tags.text
        .split(',')
        .map((t) => t.trim())
        .where((t) => t.isNotEmpty)
        .toList();
    final metadata = <String, dynamic>{
      'name': _name.text.trim(),
      'description': _description.text.trim().isEmpty ? null : _description.text.trim(),
      'servings': int.tryParse(_servings.text.trim()) ?? 1,
      'prepMinutes': int.tryParse(_prep.text.trim()),
      'cookMinutes': int.tryParse(_cook.text.trim()),
      'tags': tags,
      'imagePath': _image.text.trim().isEmpty ? null : _image.text.trim(),
      // Nutrition (ADR-0005): blank → null (clears on edit; omitted-as-null on create).
      'calories': int.tryParse(_calories.text.trim()),
      'proteinGrams': double.tryParse(_protein.text.trim()),
      'carbsGrams': double.tryParse(_carbs.text.trim()),
      'fatGrams': double.tryParse(_fat.text.trim()),
    };

    bool ok;
    if (_isEdit) {
      ok = await provider.update(widget.existing!.id, metadata);
    } else {
      final ingredients = _ingredients
          .where((i) => i.name.text.trim().isNotEmpty)
          .map((i) => {
                'name': i.name.text.trim(),
                if (i.quantity.text.trim().isNotEmpty)
                  'quantity': double.tryParse(i.quantity.text.trim()),
                if (i.unit.text.trim().isNotEmpty) 'unit': i.unit.text.trim(),
              })
          .toList();
      final steps = _steps
          .where((s) => s.text.trim().isNotEmpty)
          .map((s) => {'instruction': s.text.trim()})
          .toList();
      final created = await provider.create({...metadata, 'ingredients': ingredients, 'steps': steps});
      ok = created != null;
    }
    if (!mounted) return;
    setState(() => _busy = false);
    if (ok) {
      context.pop(true);
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(provider.error ?? 'Could not save the recipe.')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(_isEdit ? 'Edit recipe' : 'New recipe')),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            TextFormField(
              controller: _name,
              decoration: const InputDecoration(labelText: 'Name', border: OutlineInputBorder()),
              validator: (v) => validateRequired(v, 'Name'),
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _description,
              maxLines: 2,
              decoration: const InputDecoration(labelText: 'Description', border: OutlineInputBorder()),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: TextFormField(
                    controller: _servings,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(labelText: 'Servings', border: OutlineInputBorder()),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: TextFormField(
                    controller: _prep,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(labelText: 'Prep (min)', border: OutlineInputBorder()),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: TextFormField(
                    controller: _cook,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(labelText: 'Cook (min)', border: OutlineInputBorder()),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _tags,
              decoration: const InputDecoration(
                labelText: 'Tags (comma-separated)',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _image,
              keyboardType: TextInputType.url,
              decoration: const InputDecoration(
                labelText: 'Image URL',
                hintText: 'https://… (LAN-served)',
                border: OutlineInputBorder(),
                prefixIcon: Icon(Icons.image_outlined),
              ),
            ),
            if (!_isEdit) ...[
              const SizedBox(height: 24),
              _SectionHeader('Ingredients', onAdd: () => setState(() => _ingredients.add(_IngredientRow()))),
              for (var i = 0; i < _ingredients.length; i++) _ingredientRow(i),
              const SizedBox(height: 24),
              _SectionHeader('Steps', onAdd: () => setState(() => _steps.add(TextEditingController()))),
              for (var i = 0; i < _steps.length; i++) _stepRow(i),
            ],
            const SizedBox(height: 24),
            Text('Nutrition (optional)', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(child: _numField(_calories, 'Calories (kcal)')),
                const SizedBox(width: 12),
                Expanded(child: _numField(_protein, 'Protein (g)')),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(child: _numField(_carbs, 'Carbs (g)')),
                const SizedBox(width: 12),
                Expanded(child: _numField(_fat, 'Fat (g)')),
              ],
            ),
            const SizedBox(height: 24),
            FilledButton(
              onPressed: _busy ? null : _submit,
              child: _busy
                  ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2))
                  : Text(_isEdit ? 'Save' : 'Create'),
            ),
          ],
        ),
      ),
    );
  }

  static String _trimNum(double v) =>
      v == v.roundToDouble() ? v.toInt().toString() : v.toString();

  Widget _numField(TextEditingController c, String label) => TextFormField(
        controller: c,
        keyboardType: const TextInputType.numberWithOptions(decimal: true),
        decoration: InputDecoration(labelText: label, border: const OutlineInputBorder()),
      );

  Widget _ingredientRow(int i) {
    final row = _ingredients[i];
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Row(
        children: [
          Expanded(
            flex: 3,
            child: TextFormField(
              controller: row.name,
              decoration: const InputDecoration(labelText: 'Ingredient', border: OutlineInputBorder()),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: TextFormField(
              controller: row.quantity,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(labelText: 'Qty', border: OutlineInputBorder()),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: TextFormField(
              controller: row.unit,
              decoration: const InputDecoration(labelText: 'Unit', border: OutlineInputBorder()),
            ),
          ),
          IconButton(
            icon: const Icon(Icons.remove_circle_outline),
            onPressed: () => setState(() => _ingredients.removeAt(i)..dispose()),
          ),
        ],
      ),
    );
  }

  Widget _stepRow(int i) {
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Row(
        children: [
          CircleAvatar(radius: 14, child: Text('${i + 1}')),
          const SizedBox(width: 8),
          Expanded(
            child: TextFormField(
              controller: _steps[i],
              decoration: const InputDecoration(labelText: 'Instruction', border: OutlineInputBorder()),
            ),
          ),
          IconButton(
            icon: const Icon(Icons.remove_circle_outline),
            onPressed: () => setState(() => _steps.removeAt(i)),
          ),
        ],
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  final String title;
  final VoidCallback onAdd;

  const _SectionHeader(this.title, {required this.onAdd});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(title, style: Theme.of(context).textTheme.titleMedium),
        TextButton.icon(onPressed: onAdd, icon: const Icon(Icons.add), label: Text('Add $title'.replaceAll('s', ''))),
      ],
    );
  }
}
