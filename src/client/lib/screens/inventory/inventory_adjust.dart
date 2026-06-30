import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../models/inventory.dart';
import '../../providers/inventory_provider.dart';

/// Shared quick consume/restock dialog (EP-0049). Captures an amount + reason and applies a
/// signed delta via the provider, surfacing the result (incl. auto-add-to-grocery).
Future<void> showAdjustDialog(BuildContext context, InventoryItem item) async {
  final amount = TextEditingController(text: '1');
  var reason = 'consume';
  final result = await showDialog<({double amount, String reason})>(
    context: context,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, setLocal) => AlertDialog(
        title: Text('Adjust ${item.name}'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('On hand: ${item.quantityLabel}'),
            const SizedBox(height: 12),
            SegmentedButton<String>(
              segments: const [
                ButtonSegment(value: 'consume', label: Text('Consume')),
                ButtonSegment(value: 'restock', label: Text('Restock')),
              ],
              selected: {reason},
              onSelectionChanged: (s) => setLocal(() => reason = s.first),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: amount,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(labelText: 'Amount'),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton(
            onPressed: () {
              final a = double.tryParse(amount.text.trim());
              if (a == null || a <= 0) return;
              Navigator.pop(ctx, (amount: a, reason: reason));
            },
            child: const Text('Apply'),
          ),
        ],
      ),
    ),
  );
  if (result == null || !context.mounted) return;
  final provider = context.read<InventoryProvider>();
  final delta = result.reason == 'consume' ? -result.amount : result.amount;
  final groceryAdded = await provider.adjust(item.id, delta, result.reason);
  if (!context.mounted) return;
  if (groceryAdded == null) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(provider.error ?? 'Adjustment failed.')),
    );
  } else if (groceryAdded) {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Low stock — added to grocery list.')),
    );
  }
}
