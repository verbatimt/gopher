import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../models/auth_state.dart';
import '../../models/inventory.dart';
import '../../providers/auth_provider.dart';
import '../../providers/inventory_provider.dart';
import '../../widgets/status_badge.dart';
import 'inventory_adjust.dart';

/// Inventory item detail (EP-0049): full fields, adjustment history with running totals, quick
/// adjust, add-to-grocery, and role-gated edit/delete.
class InventoryDetailScreen extends StatefulWidget {
  final String itemId;

  const InventoryDetailScreen({super.key, required this.itemId});

  @override
  State<InventoryDetailScreen> createState() => _InventoryDetailScreenState();
}

class _InventoryDetailScreenState extends State<InventoryDetailScreen> {
  InventoryItem? _item;
  List<InventoryAdjustment> _history = const [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _reload());
  }

  Future<void> _reload() async {
    final auth = context.read<AuthProvider>();
    final provider = context.read<InventoryProvider>();
    // Establish household context if not yet loaded (direct navigation).
    if (provider.items.isEmpty) await provider.load(auth.householdId);
    setState(() => _loading = true);
    final item = await provider.getItem(widget.itemId);
    final history = await provider.adjustments(widget.itemId);
    if (!mounted) return;
    setState(() {
      _item = item;
      _history = history;
      _loading = false;
    });
  }

  bool _canManage(AuthProvider auth) =>
      auth.roles.contains(RoleNames.supervising) || auth.roles.contains(RoleNames.unsupervised);

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final item = _item;

    return Scaffold(
      appBar: AppBar(
        title: Text(item?.name ?? 'Item'),
        actions: item == null
            ? null
            : [
                IconButton(
                  tooltip: 'Add to grocery',
                  icon: const Icon(Icons.add_shopping_cart),
                  onPressed: () async {
                    final p = context.read<InventoryProvider>();
                    final added = await p.addToGrocery(item.id);
                    if (!context.mounted) return;
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(content: Text(added ? 'Added to grocery' : 'Already on the list')),
                    );
                  },
                ),
                if (_canManage(auth)) ...[
                  IconButton(
                    tooltip: 'Edit',
                    icon: const Icon(Icons.edit_outlined),
                    onPressed: () async {
                      await context.push('/inventory/${item.id}/edit', extra: item);
                      await _reload();
                    },
                  ),
                  IconButton(
                    tooltip: 'Delete',
                    icon: const Icon(Icons.delete_outline),
                    onPressed: () async {
                      final p = context.read<InventoryProvider>();
                      final ok = await p.deleteItem(item.id);
                      if (!context.mounted) return;
                      if (ok) context.pop();
                    },
                  ),
                ],
              ],
      ),
      floatingActionButton: item == null
          ? null
          : FloatingActionButton.extended(
              onPressed: () async {
                await showAdjustDialog(context, item);
                await _reload();
              },
              icon: const Icon(Icons.tune),
              label: const Text('Adjust'),
            ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : item == null
              ? const Center(child: Text('Item not found'))
              : ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    Row(
                      children: [
                        Text(item.quantityLabel, style: Theme.of(context).textTheme.headlineSmall),
                        const SizedBox(width: 12),
                        if (item.isLowStock) const StatusBadge('Low', tone: StatusTone.danger),
                        if (item.isExpiringSoon) ...[
                          const SizedBox(width: 6),
                          const StatusBadge('Expiring', tone: StatusTone.warning),
                        ],
                      ],
                    ),
                    const SizedBox(height: 8),
                    Text(
                      [
                        if (item.category != null) 'Category: ${item.category}',
                        if (item.location != null) 'Location: ${item.location}',
                        if (item.lowThreshold != null) 'Threshold: ${trimNum(item.lowThreshold!)}',
                        if (item.expiresAt != null) 'Expires: ${item.expiresAt}',
                      ].join('\n'),
                      style: Theme.of(context).textTheme.bodyMedium,
                    ),
                    const Divider(height: 32),
                    Text('History', style: Theme.of(context).textTheme.titleMedium),
                    if (_history.isEmpty)
                      const Padding(padding: EdgeInsets.all(8), child: Text('No adjustments yet.'))
                    else
                      for (final a in _history)
                        ListTile(
                          dense: true,
                          leading: Icon(
                            a.delta >= 0 ? Icons.add : Icons.remove,
                            color: a.delta >= 0 ? Colors.green : Colors.red,
                          ),
                          title: Text('${a.reason} ${trimNum(a.delta.abs())}'),
                          subtitle: Text('→ ${trimNum(a.resultingQuantity)}'
                              '${a.note != null ? ' · ${a.note}' : ''}'),
                        ),
                  ],
                ),
    );
  }
}
