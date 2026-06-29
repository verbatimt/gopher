import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/constants.dart';
import '../../models/dashboard.dart';
import '../../models/meal.dart';
import '../../providers/dashboard_provider.dart';
import '../../providers/health_provider.dart';
import '../../widgets/module_guard.dart';
import '../../widgets/notification_bell.dart';
import '../../widgets/status_badge.dart';

/// Aggregated home view (EP-0031): one card per active module section, each collapsible with a
/// graceful empty state. Live-refreshes from module WS events. A connection card footer keeps
/// the foundation health affordance.
class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<DashboardProvider>().load();
      context.read<HealthProvider>().refresh();
    });
  }

  @override
  Widget build(BuildContext context) {
    final data = context.watch<DashboardProvider>().data;
    return Scaffold(
      appBar: AppBar(title: const Text('Dashboard'), actions: const [NotificationBell()]),
      body: ModuleGuard(
        module: AppModules.dashboard,
        child: RefreshIndicator(
          onRefresh: () => context.read<DashboardProvider>().load(),
          child: ListView(
            padding: const EdgeInsets.all(12),
            children: [
              if (data != null) ..._sections(context, data),
              const SizedBox(height: 8),
              const _ConnectionCard(),
            ],
          ),
        ),
      ),
    );
  }

  List<Widget> _sections(BuildContext context, DashboardData d) {
    final cards = <Widget>[];

    if (d.has('tasks')) {
      final pending = d.intOf('tasks', 'pendingCount');
      final overdue = d.intOf('tasks', 'overdueCount');
      cards.add(_card(
        context,
        icon: Icons.checklist,
        title: 'Tasks',
        subtitle: '$pending pending · $overdue overdue',
        lines: d.list('tasks', 'items').map((t) => t['title'] as String? ?? '').toList(),
        empty: 'No pending tasks',
      ));
    }
    if (d.has('calendar')) {
      cards.add(_card(
        context,
        icon: Icons.calendar_today,
        title: 'Upcoming',
        lines: d.list('calendar', 'upcoming').map((e) => e['title'] as String? ?? '').toList(),
        empty: 'No upcoming events',
      ));
    }
    if (d.has('medications')) {
      cards.add(_card(
        context,
        icon: Icons.medication_outlined,
        title: 'Medications',
        subtitle: '${d.intOf('medications', 'dueCount')} due (24h)',
        lines: d
            .list('medications', 'items')
            .map((m) => m['medicationName'] as String? ?? '')
            .toList(),
        empty: 'No upcoming doses',
      ));
    }
    if (d.has('rewards')) {
      final balance = d.intOf('rewards', 'balance');
      final pendingRedemptions = d.intOf('rewards', 'pendingRedemptions');
      cards.add(_card(
        context,
        icon: Icons.card_giftcard,
        title: 'Rewards',
        subtitle: '$balance points',
        lines: pendingRedemptions > 0 ? ['$pendingRedemptions pending redemption(s)'] : const [],
        empty: 'No pending redemptions',
      ));
    }
    if (d.has('meals')) {
      cards.add(_card(
        context,
        icon: Icons.restaurant,
        title: 'Meals (today & tomorrow)',
        lines: d.list('meals', 'entries').map((e) {
          final day = (e['dayOfWeek'] as num?)?.toInt() ?? 0;
          return '${weekdayNames[day]} ${e['mealType']}: ${e['mealName']}';
        }).toList(),
        empty: 'No meals planned',
      ));
    }
    if (d.has('notifications')) {
      cards.add(_card(
        context,
        icon: Icons.notifications_outlined,
        title: 'Notifications',
        subtitle: '${d.intOf('notifications', 'unreadCount')} unread',
        lines: d.list('notifications', 'recent').map((n) => n['title'] as String? ?? '').toList(),
        empty: 'No notifications',
      ));
    }
    if (d.has('finance')) {
      cards.add(_card(
        context,
        icon: Icons.account_balance_wallet_outlined,
        title: 'Finance',
        lines: const [],
        empty: 'Coming soon',
      ));
    }
    return cards;
  }

  Widget _card(
    BuildContext context, {
    required IconData icon,
    required String title,
    String? subtitle,
    required List<String> lines,
    required String empty,
  }) {
    final visible = lines.where((l) => l.isNotEmpty).toList();
    return Card(
      child: ExpansionTile(
        initiallyExpanded: true,
        leading: Icon(icon),
        title: Text(title),
        subtitle: subtitle != null ? Text(subtitle) : null,
        childrenPadding: const EdgeInsets.only(left: 16, right: 16, bottom: 12),
        children: visible.isEmpty
            ? [Align(alignment: Alignment.centerLeft, child: Text(empty))]
            : [for (final line in visible) ListTile(dense: true, title: Text(line))],
      ),
    );
  }
}

class _ConnectionCard extends StatelessWidget {
  const _ConnectionCard();

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<HealthProvider>();
    final status = provider.status;
    final (String label, StatusTone tone) = switch (status?.healthy) {
      true => ('Healthy', StatusTone.success),
      false when status != null => ('Degraded', StatusTone.warning),
      _ => (provider.isBusy ? 'Checking…' : 'Unknown', StatusTone.neutral),
    };
    return Card(
      child: ListTile(
        leading: const Icon(Icons.cloud_outlined),
        title: const Text('API connection'),
        subtitle: status != null ? Text('API ${status.version} @ ${AppConstants.apiBaseUrl}') : null,
        trailing: StatusBadge(label, tone: tone),
        onTap: () => context.read<HealthProvider>().refresh(),
      ),
    );
  }
}
