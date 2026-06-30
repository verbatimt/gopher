import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/constants.dart';
import '../../models/household.dart';
import '../../providers/auth_provider.dart';
import '../../providers/household_provider.dart';
import '../../providers/module_provider.dart';
import '../../widgets/empty_state.dart';

/// Display metadata for one toggleable feature module. `dashboard` is intentionally absent:
/// it is always-on (the server omits it from `active_modules` and `main.dart` force-enables
/// it on session sync), so it is never shown as a switch.
class _ModuleInfo {
  final String id;
  final String label;
  final String description;
  final IconData icon;
  const _ModuleInfo(this.id, this.label, this.description, this.icon);
}

const List<_ModuleInfo> _moduleCatalog = [
  _ModuleInfo(AppModules.calendar, 'Calendar', 'Shared household calendar and events',
      Icons.calendar_today_outlined),
  _ModuleInfo(AppModules.tasks, 'Tasks', 'Chores and to-dos', Icons.task_alt),
  _ModuleInfo(AppModules.medications, 'Medications', 'Medication schedules and reminders',
      Icons.medication_outlined),
  _ModuleInfo(AppModules.health, 'Health & vitals', 'Biometrics and vitals tracking',
      Icons.monitor_heart_outlined),
  _ModuleInfo(AppModules.rewards, 'Rewards', 'Points and reward redemption',
      Icons.card_giftcard_outlined),
  _ModuleInfo(AppModules.meals, 'Meals', 'Meal planning and groceries', Icons.restaurant_outlined),
  _ModuleInfo(AppModules.inventory, 'Inventory', 'Household inventory and stock',
      Icons.inventory_2_outlined),
  _ModuleInfo(AppModules.finance, 'Finance', 'Forecasting and financial planning',
      Icons.account_balance_wallet_outlined),
];

/// Supervisor-only screen to enable/disable feature modules for the household. Each switch
/// persists immediately via PATCH `/households/:id` (activeModules) and refreshes
/// [ModuleProvider] so [ModuleGuard]s update without a reload (HouseholdProvider.updateSettings
/// does not touch ModuleProvider, and `main.dart` only syncs it on first session load).
class ModulesScreen extends StatefulWidget {
  const ModulesScreen({super.key});

  @override
  State<ModulesScreen> createState() => _ModulesScreenState();
}

class _ModulesScreenState extends State<ModulesScreen> {
  bool _saving = false;

  Future<void> _toggle(String moduleId, bool enabled) async {
    final household = context.read<HouseholdProvider>();
    final modules = context.read<ModuleProvider>();
    final current = household.household?.activeModules ?? const <String>[];

    // Persist only feature modules; dashboard is always-on and never stored here.
    final next = <String>{...current}..remove(AppModules.dashboard);
    if (enabled) {
      next.add(moduleId);
    } else {
      next.remove(moduleId);
    }
    final nextList = next.toList();

    setState(() => _saving = true);
    final ok = await household.updateSettings({'activeModules': nextList});
    if (!mounted) return;
    setState(() => _saving = false);
    if (ok) {
      // Keep dashboard on locally, matching main.dart's session sync.
      modules.setActive([...nextList, AppModules.dashboard]);
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not update modules. Please try again.')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isSupervisor = context.watch<AuthProvider>().isSupervisor;
    final household = context.watch<HouseholdProvider>().household;

    return Scaffold(
      appBar: AppBar(title: const Text('Modules')),
      body: _buildBody(theme, isSupervisor, household),
    );
  }

  Widget _buildBody(ThemeData theme, bool isSupervisor, Household? household) {
    if (!isSupervisor) {
      return const EmptyState(
        icon: Icons.lock_outline,
        title: 'Supervisor access required',
        message: 'Only a household supervisor can manage feature modules.',
      );
    }
    if (household == null) {
      return const Center(child: CircularProgressIndicator());
    }
    final active = household.activeModules;
    return ListView(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
          child: Text(
            'Turn household features on or off. Disabled modules are hidden from everyone '
            'in the household.',
            style: theme.textTheme.bodyMedium,
          ),
        ),
        for (final m in _moduleCatalog)
          SwitchListTile(
            key: ValueKey('module-${m.id}'),
            secondary: Icon(m.icon),
            title: Text(m.label),
            subtitle: Text(m.description),
            value: active.contains(m.id),
            onChanged: _saving ? null : (v) => _toggle(m.id, v),
          ),
      ],
    );
  }
}
