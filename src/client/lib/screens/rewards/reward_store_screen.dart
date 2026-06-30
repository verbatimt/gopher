import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/constants.dart';
import '../../models/reward.dart';
import '../../providers/auth_provider.dart';
import '../../providers/reward_provider.dart';
import '../../widgets/empty_state.dart';
import '../../widgets/module_guard.dart';
import '../../widgets/status_badge.dart';

/// Reward Store (EP-0027): browse the redeemable catalog with the member's point balance and
/// redeem items; supervisors (rewards:manage) can create / edit / deactivate catalog items.
/// Redemptions are created as pending and debit the balance on supervisor approval.
class RewardStoreScreen extends StatefulWidget {
  const RewardStoreScreen({super.key});

  @override
  State<RewardStoreScreen> createState() => _RewardStoreScreenState();
}

class _RewardStoreScreenState extends State<RewardStoreScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final auth = context.read<AuthProvider>();
      if (auth.householdId.isNotEmpty) context.read<RewardProvider>().load(auth.householdId);
    });
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<RewardProvider>();
    final auth = context.watch<AuthProvider>();
    final isSupervisor = auth.isSupervisor;
    final ownBalance = provider.ownBalance.balance;

    return Scaffold(
      appBar: AppBar(title: const Text('Reward store')),
      floatingActionButton: isSupervisor
          ? FloatingActionButton.extended(
              onPressed: () => _itemDialog(context),
              icon: const Icon(Icons.add),
              label: const Text('New item'),
            )
          : null,
      body: ModuleGuard(
        module: AppModules.rewards,
        child: RefreshIndicator(
          onRefresh: () => context.read<RewardProvider>().load(auth.householdId),
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              _balanceCard(context, ownBalance),
              const SizedBox(height: 16),
              Text('Catalog', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 8),
              if (provider.store.isEmpty)
                const Padding(
                  padding: EdgeInsets.only(top: 24),
                  child: EmptyState(
                    icon: Icons.card_giftcard_outlined,
                    title: 'No rewards yet',
                    message: 'Catalog items added by a supervisor will appear here.',
                  ),
                )
              else
                for (final item in provider.store)
                  _storeCard(context, item, ownBalance, isSupervisor),
            ],
          ),
        ),
      ),
    );
  }

  Widget _balanceCard(BuildContext context, int balance) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            const Icon(Icons.stars_outlined),
            const SizedBox(width: 12),
            Text('$balance points', style: Theme.of(context).textTheme.headlineSmall),
            const Spacer(),
            Text('Your balance', style: Theme.of(context).textTheme.bodySmall),
          ],
        ),
      ),
    );
  }

  Widget _storeCard(BuildContext context, RewardStoreItem item, int ownBalance, bool isSupervisor) {
    final theme = Theme.of(context);
    final affordable = item.affordableFor(ownBalance);
    final meta = <String>[
      '${item.pointCost} points',
      if (item.redemptionCap != null) 'redeemed ${item.redemptionCount}/${item.redemptionCap}',
      if (item.cooldownMinutes != null) 'cooldown ${item.cooldownMinutes}m',
    ].join(' · ');

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(child: Text(item.name, style: theme.textTheme.titleMedium)),
                      if (item.capReached) const StatusBadge('Sold out', tone: StatusTone.danger),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(meta, style: theme.textTheme.bodySmall),
                  if (item.description != null && item.description!.isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Text(item.description!, style: theme.textTheme.bodyMedium),
                  ],
                ],
              ),
            ),
            const SizedBox(width: 8),
            Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                FilledButton(
                  onPressed: affordable ? () => _redeem(context, item) : null,
                  child: const Text('Redeem'),
                ),
                if (isSupervisor)
                  PopupMenuButton<String>(
                    tooltip: 'Manage item',
                    onSelected: (v) {
                      if (v == 'edit') {
                        _itemDialog(context, existing: item);
                      } else if (v == 'deactivate') {
                        _confirmDeactivate(context, item);
                      }
                    },
                    itemBuilder: (_) => const [
                      PopupMenuItem(value: 'edit', child: Text('Edit')),
                      PopupMenuItem(value: 'deactivate', child: Text('Deactivate')),
                    ],
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _redeem(BuildContext context, RewardStoreItem item) async {
    final ok = await context.read<RewardProvider>().redeem(item.id);
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(ok
            ? 'Redemption requested — pending approval'
            : (context.read<RewardProvider>().error ?? 'Could not redeem this reward.')),
      ),
    );
  }

  Future<void> _confirmDeactivate(BuildContext context, RewardStoreItem item) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Deactivate item?'),
        content: Text('"${item.name}" will be removed from the store. Existing transactions '
            'are kept.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Deactivate')),
        ],
      ),
    );
    if (confirmed != true || !context.mounted) return;
    final ok = await context.read<RewardProvider>().deactivateStoreItem(item.id);
    if (!context.mounted) return;
    if (!ok) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not deactivate the item.')),
      );
    }
  }

  Future<void> _itemDialog(BuildContext context, {RewardStoreItem? existing}) async {
    final name = TextEditingController(text: existing?.name ?? '');
    final description = TextEditingController(text: existing?.description ?? '');
    final cost = TextEditingController(text: existing != null ? '${existing.pointCost}' : '');
    final cap = TextEditingController(
      text: existing?.redemptionCap != null ? '${existing!.redemptionCap}' : '',
    );
    final cooldown = TextEditingController(
      text: existing?.cooldownMinutes != null ? '${existing!.cooldownMinutes}' : '',
    );

    final result = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(existing == null ? 'New reward' : 'Edit reward'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(controller: name, decoration: const InputDecoration(labelText: 'Name')),
              TextField(
                controller: description,
                decoration: const InputDecoration(labelText: 'Description (optional)'),
              ),
              TextField(
                controller: cost,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(labelText: 'Point cost'),
              ),
              TextField(
                controller: cap,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(labelText: 'Redemption cap (optional)'),
              ),
              TextField(
                controller: cooldown,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(labelText: 'Cooldown minutes (optional)'),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: Text(existing == null ? 'Create' : 'Save'),
          ),
        ],
      ),
    );
    if (result != true || !context.mounted) return;

    final pointCost = int.tryParse(cost.text.trim());
    if (name.text.trim().isEmpty || pointCost == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('A name and a numeric point cost are required.')),
      );
      return;
    }
    // Only send keys with a value — the server's optional fields reject an explicit null.
    final body = <String, dynamic>{'name': name.text.trim(), 'pointCost': pointCost};
    final desc = description.text.trim();
    if (desc.isNotEmpty) body['description'] = desc;
    final capValue = int.tryParse(cap.text.trim());
    if (capValue != null) body['redemptionCap'] = capValue;
    final cooldownValue = int.tryParse(cooldown.text.trim());
    if (cooldownValue != null) body['cooldownMinutes'] = cooldownValue;

    final provider = context.read<RewardProvider>();
    final ok = existing == null
        ? await provider.createStoreItem(body)
        : await provider.updateStoreItem(existing.id, body);
    if (!context.mounted) return;
    if (!ok) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(provider.error ?? 'Could not save the reward.')),
      );
    }
  }
}
