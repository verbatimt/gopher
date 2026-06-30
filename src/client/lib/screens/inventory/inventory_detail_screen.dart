import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../models/auth_state.dart';
import '../../models/inventory.dart';
import '../../providers/auth_provider.dart';
import '../../providers/inventory_provider.dart';
import '../../widgets/remote_image.dart';
import '../../widgets/status_badge.dart';
import 'inventory_adjust.dart';

/// Inventory item detail (EP-0049): full fields, adjustment history with running totals, quick
/// adjust, add-to-grocery, and role-gated edit/delete.
///
/// Full-screen route wrapper. The content lives in [InventoryDetailView] so it can also be
/// embedded as the detail pane of the canonical list-detail layout on wide windows.
class InventoryDetailScreen extends StatelessWidget {
  final String itemId;

  const InventoryDetailScreen({super.key, required this.itemId});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Item')),
      body: InventoryDetailView(itemId: itemId, showHeader: true),
    );
  }
}

/// Self-contained inventory item detail (no Scaffold/AppBar). Loads the item + its adjustment
/// history, and — when [showHeader] is true — renders an in-body title and action row for use
/// inside a list-detail pane. [onDeleted] runs after a successful delete (pane: clear selection).
class InventoryDetailView extends StatefulWidget {
  final String itemId;
  final bool showHeader;
  final VoidCallback? onDeleted;

  const InventoryDetailView({
    super.key,
    required this.itemId,
    this.showHeader = false,
    this.onDeleted,
  });

  @override
  State<InventoryDetailView> createState() => _InventoryDetailViewState();
}

class _InventoryDetailViewState extends State<InventoryDetailView> {
  InventoryItem? _item;
  List<InventoryAdjustment> _history = const [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _reload());
  }

  @override
  void didUpdateWidget(InventoryDetailView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.itemId != widget.itemId) _reload();
  }

  Future<void> _reload() async {
    final auth = context.read<AuthProvider>();
    final provider = context.read<InventoryProvider>();
    // Establish household context if not yet loaded (direct navigation).
    if (provider.items.isEmpty) await provider.load(auth.householdId);
    if (!mounted) return;
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

  Future<void> _addToGrocery(InventoryItem item) async {
    final p = context.read<InventoryProvider>();
    final added = await p.addToGrocery(item.id);
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(added ? 'Added to grocery' : 'Already on the list')),
    );
  }

  Future<void> _adjust(InventoryItem item) async {
    await showAdjustDialog(context, item);
    await _reload();
  }

  Future<void> _edit(InventoryItem item) async {
    await context.push('/inventory/${item.id}/edit', extra: item);
    await _reload();
  }

  Future<void> _delete(InventoryItem item) async {
    final ok = await context.read<InventoryProvider>().deleteItem(item.id);
    if (ok) widget.onDeleted?.call();
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();

    if (_loading) return const Center(child: CircularProgressIndicator());
    final item = _item;
    if (item == null) return const Center(child: Text('Item not found'));

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        if (widget.showHeader) ...[
          Row(
            children: [
              Expanded(
                child: Text(item.name, style: Theme.of(context).textTheme.titleLarge),
              ),
              IconButton(
                tooltip: 'Add to grocery',
                icon: const Icon(Icons.add_shopping_cart),
                onPressed: () => _addToGrocery(item),
              ),
              IconButton(
                tooltip: 'Adjust',
                icon: const Icon(Icons.tune),
                onPressed: () => _adjust(item),
              ),
              if (_canManage(auth)) ...[
                IconButton(
                  tooltip: 'Edit',
                  icon: const Icon(Icons.edit_outlined),
                  onPressed: () => _edit(item),
                ),
                IconButton(
                  tooltip: 'Delete',
                  icon: const Icon(Icons.delete_outline),
                  onPressed: () => _delete(item),
                ),
              ],
            ],
          ),
          const Divider(height: 24),
        ],
        if (item.imagePath != null && item.imagePath!.isNotEmpty) ...[
          RemoteImage(
            path: item.imagePath,
            height: 180,
            width: double.infinity,
            placeholderIcon: Icons.inventory_2_outlined,
          ),
          const SizedBox(height: 12),
        ],
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
    );
  }
}
