import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../../models/auth_state.dart';
import '../../models/medication.dart';
import '../../providers/auth_provider.dart';
import '../../providers/medication_provider.dart';
import '../../widgets/status_badge.dart';

/// Detail for one medication schedule: compliance summary, dose history with "Log dose"
/// (taken/skipped, honoring the dose window via the server rule), and refill history with
/// "Log refill". Write actions are hidden from supervised members.
class MedicationDetailScreen extends StatefulWidget {
  final String scheduleId;

  const MedicationDetailScreen({super.key, required this.scheduleId});

  @override
  State<MedicationDetailScreen> createState() => _MedicationDetailScreenState();
}

class _MedicationDetailScreenState extends State<MedicationDetailScreen> {
  MedicationSchedule? _schedule;
  List<MedicationDose> _doses = const [];
  List<MedicationRefill> _refills = const [];
  MedicationCompliance? _compliance;
  bool _loading = true;

  final _dateFmt = DateFormat('MMM d, HH:mm');

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _refresh());
  }

  Future<void> _refresh() async {
    final provider = context.read<MedicationProvider>();
    final schedule = await provider.fetchSchedule(widget.scheduleId);
    final doses = await provider.doses(widget.scheduleId);
    final refills = await provider.refills(widget.scheduleId);
    final compliance = await provider.compliance(widget.scheduleId);
    if (!mounted) return;
    setState(() {
      _schedule = schedule;
      _doses = doses;
      _refills = refills;
      _compliance = compliance;
      _loading = false;
    });
  }

  bool get _canWrite {
    final roles = context.read<AuthProvider>().roles;
    return roles.contains(RoleNames.supervising) || roles.contains(RoleNames.unsupervised);
  }

  Future<void> _logDose(String status) async {
    final provider = context.read<MedicationProvider>();
    final dose = await provider.logDose(widget.scheduleId, {
      'status': status,
      'takenAt': DateTime.now().toUtc().toIso8601String(),
    });
    if (!mounted) return;
    if (dose == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(provider.error ?? 'Outside the dose window — not logged.')),
      );
    } else {
      await _refresh();
    }
  }

  Future<void> _logRefill() async {
    final controller = TextEditingController(text: '30');
    final qty = await showDialog<double>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Log refill'),
        content: TextField(
          controller: controller,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          decoration: const InputDecoration(labelText: 'Quantity added'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, double.tryParse(controller.text.trim())),
            child: const Text('Add'),
          ),
        ],
      ),
    );
    if (qty == null || qty <= 0 || !mounted) return;
    final provider = context.read<MedicationProvider>();
    final ok = await provider.logRefill(widget.scheduleId, {'quantityAdded': qty});
    if (!mounted) return;
    if (ok) {
      await _refresh();
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(provider.error ?? 'Could not log the refill')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final schedule = _schedule;
    return Scaffold(
      appBar: AppBar(title: Text(schedule?.medicationName ?? 'Medication')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : schedule == null
              ? const Center(child: Text('Schedule not found'))
              : RefreshIndicator(
                  onRefresh: _refresh,
                  child: ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      _header(schedule),
                      const SizedBox(height: 16),
                      if (_compliance != null) _complianceCard(_compliance!),
                      if (_canWrite) ...[
                        const SizedBox(height: 16),
                        Row(
                          children: [
                            Expanded(
                              child: FilledButton.icon(
                                icon: const Icon(Icons.check),
                                label: const Text('Taken'),
                                onPressed: () => _logDose('taken'),
                              ),
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: OutlinedButton.icon(
                                icon: const Icon(Icons.block),
                                label: const Text('Skipped'),
                                onPressed: () => _logDose('skipped'),
                              ),
                            ),
                          ],
                        ),
                      ],
                      const SizedBox(height: 24),
                      Text('Doses', style: Theme.of(context).textTheme.titleMedium),
                      if (_doses.isEmpty)
                        const Padding(
                          padding: EdgeInsets.symmetric(vertical: 8),
                          child: Text('No doses yet'),
                        ),
                      for (final dose in _doses) _doseTile(dose),
                      const SizedBox(height: 24),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text('Refills', style: Theme.of(context).textTheme.titleMedium),
                          if (_canWrite)
                            TextButton.icon(
                              onPressed: _logRefill,
                              icon: const Icon(Icons.add),
                              label: const Text('Log refill'),
                            ),
                        ],
                      ),
                      if (_refills.isEmpty)
                        const Padding(
                          padding: EdgeInsets.symmetric(vertical: 8),
                          child: Text('No refills yet'),
                        ),
                      for (final refill in _refills) _refillTile(refill),
                    ],
                  ),
                ),
    );
  }

  Widget _header(MedicationSchedule schedule) {
    final (label, tone) = schedule.isLowStock
        ? ('Low stock', StatusTone.danger)
        : ('${schedule.stock.toStringAsFixed(0)} in stock', StatusTone.neutral);
    return Card(
      child: ListTile(
        leading: const Icon(Icons.medication_outlined),
        title: Text(schedule.dosageLabel),
        subtitle: Text('Refill at ${schedule.threshold.toStringAsFixed(0)}'),
        trailing: StatusBadge(label, tone: tone),
      ),
    );
  }

  Widget _complianceCard(MedicationCompliance c) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Adherence: ${c.adherencePct.toStringAsFixed(1)}%',
                style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              children: [
                StatusBadge('${c.taken} taken', tone: StatusTone.success),
                StatusBadge('${c.skipped} skipped', tone: StatusTone.neutral),
                StatusBadge('${c.missed} missed', tone: StatusTone.danger),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _doseTile(MedicationDose dose) {
    final (label, tone) = switch (dose.status) {
      'taken' => ('Taken', StatusTone.success),
      'skipped' => ('Skipped', StatusTone.neutral),
      'missed' => ('Missed', StatusTone.danger),
      _ => ('Pending', StatusTone.warning),
    };
    return ListTile(
      dense: true,
      leading: const Icon(Icons.schedule),
      title: Text(_dateFmt.format(dose.scheduledAt.toLocal())),
      trailing: StatusBadge(label, tone: tone),
    );
  }

  Widget _refillTile(MedicationRefill refill) {
    return ListTile(
      dense: true,
      leading: const Icon(Icons.add_box_outlined),
      title: Text('+${refill.quantityAdded}'),
      subtitle: Text(refill.refillDate),
    );
  }
}
