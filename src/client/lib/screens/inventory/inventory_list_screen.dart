import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../core/constants.dart';
import '../../models/auth_state.dart';
import '../../models/inventory.dart';
import '../../providers/auth_provider.dart';
import '../../providers/inventory_provider.dart';
import '../../widgets/empty_state.dart';
import '../../widgets/module_guard.dart';
import '../../widgets/status_badge.dart';
import 'inventory_adjust.dart';

/// Household inventory list (EP-0049): items with low-stock/expiring badges, a search + low-stock
/// filter, quick consume/restock, and a role-gated add FAB.
class InventoryListScreen extends StatefulWidget {
  const InventoryListScreen({super.key});

  @override
  State<InventoryListScreen> createState() => _InventoryListScreenState();
}

class _InventoryListScreenState extends State<InventoryListScreen> {
  final _search = TextEditingController();
  bool _lowOnly = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _reload());
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  void _reload() {
    final auth = context.read<AuthProvider>();
    if (auth.householdId.isEmpty) return;
    context.read<InventoryProvider>().load(
          auth.householdId,
          lowStock: _lowOnly ? true : null,
          search: _search.text.trim(),
        );
  }

  bool _canManage(AuthProvider auth) =>
      auth.roles.contains(RoleNames.supervising) || auth.roles.contains(RoleNames.unsupervised);

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final provider = context.watch<InventoryProvider>();

    return Scaffold(
      appBar: AppBar(title: const Text('Inventory')),
      floatingActionButton: _canManage(auth)
          ? FloatingActionButton.extended(
              onPressed: () async {
                final p = context.read<InventoryProvider>();
                await context.push('/inventory/new');
                if (mounted) p.load(auth.householdId);
              },
              icon: const Icon(Icons.add),
              label: const Text('New item'),
            )
          : null,
      body: ModuleGuard(
        module: AppModules.inventory,
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 12, 12, 0),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _search,
                      decoration: const InputDecoration(
                        hintText: 'Search items',
                        border: OutlineInputBorder(),
                        prefixIcon: Icon(Icons.search),
                      ),
                      onSubmitted: (_) => _reload(),
                    ),
                  ),
                  const SizedBox(width: 8),
                  FilterChip(
                    label: const Text('Low stock'),
                    selected: _lowOnly,
                    onSelected: (v) {
                      setState(() => _lowOnly = v);
                      _reload();
                    },
                  ),
                ],
              ),
            ),
            Expanded(
              child: provider.items.isEmpty
                  ? const EmptyState(
                      icon: Icons.inventory_2_outlined,
                      title: 'No items',
                      message: 'Add household consumables to track stock.',
                    )
                  : RefreshIndicator(
                      onRefresh: () async => _reload(),
                      child: ListView(
                        children: [for (final item in provider.items) _ItemTile(item: item)],
                      ),
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ItemTile extends StatelessWidget {
  final InventoryItem item;

  const _ItemTile({required this.item});

  @override
  Widget build(BuildContext context) {
    final badges = <Widget>[
      if (item.isLowStock) const StatusBadge('Low', tone: StatusTone.danger),
      if (item.isExpiringSoon) const StatusBadge('Expiring', tone: StatusTone.warning),
    ];
    return ListTile(
      leading: const Icon(Icons.inventory_2_outlined),
      title: Text(item.name),
      subtitle: Text([
        item.quantityLabel,
        if (item.location != null) item.location!,
        if (item.category != null) item.category!,
      ].join(' · ')),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          ...badges,
          IconButton(
            tooltip: 'Adjust',
            icon: const Icon(Icons.tune),
            onPressed: () => showAdjustDialog(context, item),
          ),
        ],
      ),
      onTap: () => context.push('/inventory/${item.id}'),
    );
  }
}
