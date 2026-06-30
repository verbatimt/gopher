import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../core/constants.dart';
import '../../models/reward.dart';
import '../../providers/auth_provider.dart';
import '../../providers/household_provider.dart';
import '../../providers/reward_provider.dart';
import '../../widgets/module_guard.dart';
import '../../widgets/notification_bell.dart';
import '../../widgets/status_badge.dart';

/// Rewards hub (EP-0029): balance + lifetime stats, a redeemable store (affordability-gated),
/// transaction history, and — for supervisors — a member selector, approve/reject of pending
/// redemptions, and balance adjustments. Live-updates via WS.
class RewardsScreen extends StatefulWidget {
  const RewardsScreen({super.key});

  @override
  State<RewardsScreen> createState() => _RewardsScreenState();
}

class _RewardsScreenState extends State<RewardsScreen> {
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
    final viewed = provider.viewedBalance;
    final ownBalance = provider.ownBalance.balance;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Rewards'),
        actions: [
          IconButton(
            tooltip: 'Reward store',
            icon: const Icon(Icons.storefront_outlined),
            onPressed: () => context.push('/rewards/store'),
          ),
          const NotificationBell(),
        ],
      ),
      body: ModuleGuard(
        module: AppModules.rewards,
        child: RefreshIndicator(
          onRefresh: () => context.read<RewardProvider>().load(auth.householdId),
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              if (isSupervisor) _memberSelector(context, provider),
              _balanceCard(context, viewed, isSupervisor),
              const SizedBox(height: 24),
              Text('Store', style: Theme.of(context).textTheme.titleMedium),
              if (provider.store.isEmpty)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 8),
                  child: Text('No rewards available yet'),
                ),
              for (final item in provider.store) _storeTile(context, item, ownBalance),
              const SizedBox(height: 24),
              Text('History', style: Theme.of(context).textTheme.titleMedium),
              if (provider.transactions.isEmpty)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 8),
                  child: Text('No transactions yet'),
                ),
              for (final tx in provider.transactions) _txTile(context, tx, isSupervisor),
            ],
          ),
        ),
      ),
    );
  }

  Widget _memberSelector(BuildContext context, RewardProvider provider) {
    final members = context.watch<HouseholdProvider>().members;
    if (members.isEmpty) return const SizedBox.shrink();
    final viewedId = provider.viewedBalance.memberId;
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        children: [
          const Text('Viewing: '),
          const SizedBox(width: 8),
          Expanded(
            child: DropdownButton<String>(
              isExpanded: true,
              value: members.any((m) => m.id == viewedId) ? viewedId : null,
              items: [
                for (final m in members)
                  DropdownMenuItem(value: m.id, child: Text(m.displayName)),
              ],
              onChanged: (id) {
                if (id != null) context.read<RewardProvider>().viewMember(id);
              },
            ),
          ),
        ],
      ),
    );
  }

  Widget _balanceCard(BuildContext context, RewardBalance balance, bool isSupervisor) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('${balance.balance} points',
                style: Theme.of(context).textTheme.headlineMedium),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              children: [
                StatusBadge('Earned ${balance.lifetimeEarned}', tone: StatusTone.success),
                StatusBadge('Redeemed ${balance.lifetimeRedeemed}', tone: StatusTone.neutral),
              ],
            ),
            if (isSupervisor) ...[
              const SizedBox(height: 12),
              OutlinedButton.icon(
                icon: const Icon(Icons.tune),
                label: const Text('Adjust'),
                onPressed: () => _adjustDialog(context, balance.memberId),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _storeTile(BuildContext context, RewardStoreItem item, int ownBalance) {
    final affordable = item.affordableFor(ownBalance);
    return Card(
      child: ListTile(
        title: Text(item.name),
        subtitle: Text(item.capReached ? 'Sold out' : '${item.pointCost} points'),
        trailing: FilledButton(
          onPressed: affordable
              ? () async {
                  final ok = await context.read<RewardProvider>().redeem(item.id);
                  if (context.mounted && ok) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('Redemption requested')),
                    );
                  }
                }
              : null,
          child: const Text('Redeem'),
        ),
      ),
    );
  }

  Widget _txTile(BuildContext context, RewardTransaction tx, bool isSupervisor) {
    final (label, tone) = switch (tx.status) {
      'approved' => ('Approved', StatusTone.success),
      'rejected' => ('Rejected', StatusTone.danger),
      _ => ('Pending', StatusTone.warning),
    };
    final sign = tx.amount >= 0 ? '+' : '';
    return ListTile(
      dense: true,
      leading: Icon(switch (tx.type) {
        'earn' => Icons.add_circle_outline,
        'redeem' => Icons.redeem,
        _ => Icons.tune,
      }),
      title: Text('${tx.type} · $sign${tx.amount}'),
      subtitle: tx.notes != null ? Text(tx.notes!) : null,
      trailing: isSupervisor && tx.isPendingRedeem
          ? Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                IconButton(
                  tooltip: 'Approve',
                  icon: const Icon(Icons.check),
                  onPressed: () => context.read<RewardProvider>().decide(tx.id, 'approve'),
                ),
                IconButton(
                  tooltip: 'Reject',
                  icon: const Icon(Icons.close),
                  onPressed: () => context.read<RewardProvider>().decide(tx.id, 'reject'),
                ),
              ],
            )
          : StatusBadge(label, tone: tone),
    );
  }

  Future<void> _adjustDialog(BuildContext context, String? memberId) async {
    if (memberId == null) return;
    final amount = TextEditingController();
    final notes = TextEditingController();
    final result = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Adjust balance'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: amount,
              keyboardType: const TextInputType.numberWithOptions(signed: true),
              decoration: const InputDecoration(labelText: 'Amount (+/-)'),
            ),
            TextField(
              controller: notes,
              decoration: const InputDecoration(labelText: 'Reason (required)'),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Apply')),
        ],
      ),
    );
    if (result != true || !context.mounted) return;
    final value = int.tryParse(amount.text.trim());
    if (value == null || notes.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('An amount and a reason are required.')),
      );
      return;
    }
    await context.read<RewardProvider>().adjust(memberId, value, notes.text.trim());
  }
}
