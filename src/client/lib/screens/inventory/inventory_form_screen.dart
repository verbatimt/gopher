import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../core/validators.dart';
import '../../models/inventory.dart';
import '../../providers/inventory_provider.dart';

/// Create or edit an inventory item (EP-0049). Starting quantity is set on create only;
/// thereafter quantity changes flow through adjustments.
class InventoryFormScreen extends StatefulWidget {
  final InventoryItem? existing;

  const InventoryFormScreen({super.key, this.existing});

  @override
  State<InventoryFormScreen> createState() => _InventoryFormScreenState();
}

class _InventoryFormScreenState extends State<InventoryFormScreen> {
  final _formKey = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _category = TextEditingController();
  final _unit = TextEditingController();
  final _quantity = TextEditingController(text: '0');
  final _location = TextEditingController();
  final _threshold = TextEditingController();
  final _notes = TextEditingController();
  DateTime? _expiresAt;
  bool _autoAdd = true;
  bool _busy = false;

  bool get _isEdit => widget.existing != null;

  @override
  void initState() {
    super.initState();
    final e = widget.existing;
    if (e != null) {
      _name.text = e.name;
      _category.text = e.category ?? '';
      _unit.text = e.unit ?? '';
      _location.text = e.location ?? '';
      if (e.lowThreshold != null) _threshold.text = trimNum(e.lowThreshold!);
      _notes.text = e.notes ?? '';
      _autoAdd = e.autoAddToGrocery;
      if (e.expiresAt != null) _expiresAt = DateTime.tryParse(e.expiresAt!);
    }
  }

  @override
  void dispose() {
    _name.dispose();
    _category.dispose();
    _unit.dispose();
    _quantity.dispose();
    _location.dispose();
    _threshold.dispose();
    _notes.dispose();
    super.dispose();
  }

  String? _ymd(DateTime? d) => d == null
      ? null
      : '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _busy = true);
    final provider = context.read<InventoryProvider>();
    final body = <String, dynamic>{
      'name': _name.text.trim(),
      'category': _category.text.trim().isEmpty ? null : _category.text.trim(),
      'unit': _unit.text.trim().isEmpty ? null : _unit.text.trim(),
      'location': _location.text.trim().isEmpty ? null : _location.text.trim(),
      'lowThreshold': double.tryParse(_threshold.text.trim()),
      'expiresAt': _ymd(_expiresAt),
      'autoAddToGrocery': _autoAdd,
      'notes': _notes.text.trim().isEmpty ? null : _notes.text.trim(),
      if (!_isEdit) 'quantity': double.tryParse(_quantity.text.trim()) ?? 0,
    };
    final ok = _isEdit
        ? await provider.updateItem(widget.existing!.id, body)
        : await provider.createItem(body);
    if (!mounted) return;
    setState(() => _busy = false);
    if (ok) {
      context.pop(true);
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(provider.error ?? 'Could not save the item.')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(_isEdit ? 'Edit item' : 'New item')),
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
            Row(
              children: [
                Expanded(
                  child: TextFormField(
                    controller: _category,
                    decoration: const InputDecoration(labelText: 'Category', border: OutlineInputBorder()),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: TextFormField(
                    controller: _location,
                    decoration: const InputDecoration(labelText: 'Location', border: OutlineInputBorder()),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: TextFormField(
                    controller: _unit,
                    decoration: const InputDecoration(labelText: 'Unit', border: OutlineInputBorder()),
                  ),
                ),
                const SizedBox(width: 12),
                if (!_isEdit)
                  Expanded(
                    child: TextFormField(
                      controller: _quantity,
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      decoration: const InputDecoration(labelText: 'Quantity', border: OutlineInputBorder()),
                    ),
                  ),
                if (_isEdit) const Expanded(child: SizedBox.shrink()),
              ],
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _threshold,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(
                labelText: 'Low-stock threshold',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            OutlinedButton.icon(
              icon: const Icon(Icons.event),
              label: Text(_expiresAt == null ? 'Set expiry (optional)' : 'Expires: ${_ymd(_expiresAt)}'),
              onPressed: () async {
                final picked = await showDatePicker(
                  context: context,
                  initialDate: _expiresAt ?? DateTime.now(),
                  firstDate: DateTime(2020),
                  lastDate: DateTime(2035),
                );
                if (picked != null) setState(() => _expiresAt = picked);
              },
            ),
            SwitchListTile(
              title: const Text('Auto-add to grocery when low'),
              value: _autoAdd,
              onChanged: (v) => setState(() => _autoAdd = v),
            ),
            TextFormField(
              controller: _notes,
              maxLines: 2,
              decoration: const InputDecoration(labelText: 'Notes', border: OutlineInputBorder()),
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
}
