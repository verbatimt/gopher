import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../core/constants.dart';
import '../../models/medication.dart';
import '../../providers/auth_provider.dart';
import '../../providers/medication_provider.dart';
import '../../widgets/module_guard.dart';
import '../../widgets/notification_bell.dart';
import '../../widgets/status_badge.dart';

/// Medication schedules for the household (supervisors) or the signed-in member (others).
/// Supervisors can add a schedule; a live `medication.reminder` surfaces as a SnackBar.
class MedicationListScreen extends StatefulWidget {
  const MedicationListScreen({super.key});

  @override
  State<MedicationListScreen> createState() => _MedicationListScreenState();
}

class _MedicationListScreenState extends State<MedicationListScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final auth = context.read<AuthProvider>();
      if (auth.householdId.isNotEmpty) {
        context.read<MedicationProvider>().load(auth.householdId);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<MedicationProvider>();
    final auth = context.watch<AuthProvider>();

    // Surface a live reminder once, then clear it.
    final reminder = provider.lastReminder;
    if (reminder != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(reminder)));
        provider.clearReminder();
      });
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Medications'), actions: const [NotificationBell()]),
      floatingActionButton: auth.isSupervisor
          ? FloatingActionButton.extended(
              onPressed: () => context.push('/medications/new'),
              icon: const Icon(Icons.add),
              label: const Text('New schedule'),
            )
          : null,
      body: ModuleGuard(
        module: AppModules.medications,
        child: provider.schedules.isEmpty
            ? Center(
                child: Text('No medication schedules',
                    style: Theme.of(context).textTheme.bodyMedium),
              )
            : RefreshIndicator(
                onRefresh: () => context.read<MedicationProvider>().load(auth.householdId),
                child: ListView(
                  children: [
                    for (final schedule in provider.schedules) _ScheduleTile(schedule: schedule),
                  ],
                ),
              ),
      ),
    );
  }
}

/// Human summary of the dosing recurrence parsed from the stored RRULE.
String recurrenceSummary(String rrule) {
  final freqMatch = RegExp(r'FREQ=([A-Z]+)').firstMatch(rrule);
  final hours = RegExp(r'BYHOUR=([0-9,]+)').firstMatch(rrule)?.group(1);
  final freq = switch (freqMatch?.group(1)) {
    'DAILY' => 'Daily',
    'WEEKLY' => 'Weekly',
    'MONTHLY' => 'Monthly',
    'YEARLY' => 'Yearly',
    _ => 'Scheduled',
  };
  if (hours == null) return freq;
  final times = hours.split(',').map((h) => '${h.padLeft(2, '0')}:00').join(', ');
  return '$freq at $times';
}

class _ScheduleTile extends StatelessWidget {
  final MedicationSchedule schedule;

  const _ScheduleTile({required this.schedule});

  @override
  Widget build(BuildContext context) {
    final (label, tone) = schedule.isLowStock
        ? ('Low stock', StatusTone.danger)
        : ('${schedule.stock.toStringAsFixed(0)} left', StatusTone.neutral);
    return ListTile(
      leading: const Icon(Icons.medication_outlined),
      title: Text(schedule.medicationName),
      subtitle: Text('${schedule.dosageLabel} · ${recurrenceSummary(schedule.rrule)}'),
      trailing: StatusBadge(label, tone: tone),
      onTap: () => context.push('/medications/${schedule.id}'),
    );
  }
}
