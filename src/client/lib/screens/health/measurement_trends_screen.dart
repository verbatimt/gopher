import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../models/auth_state.dart';
import '../../models/biometric.dart';
import '../../providers/auth_provider.dart';
import '../../providers/biometric_provider.dart';
import '../../widgets/vitals_trend_chart.dart';

/// Trend detail for one member + measurement type (EP-0044): a line chart over a selectable
/// range with min/max/avg/latest summary and the target/normal band shaded, plus a target
/// editor (supervisor, or self for an unsupervised user).
class MeasurementTrendsScreen extends StatefulWidget {
  final String memberId;
  final String typeKey;

  const MeasurementTrendsScreen({super.key, required this.memberId, required this.typeKey});

  @override
  State<MeasurementTrendsScreen> createState() => _MeasurementTrendsScreenState();
}

class _MeasurementTrendsScreenState extends State<MeasurementTrendsScreen> {
  int _days = 30; // 0 ⇒ all time
  MeasurementTrend? _trend;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _reload());
  }

  Future<void> _reload() async {
    final auth = context.read<AuthProvider>();
    final provider = context.read<BiometricProvider>();
    setState(() => _loading = true);
    if (provider.types.isEmpty) await provider.loadTypes(auth.householdId);
    // Loads targets for the member (used for band shading + adherence display).
    await provider.loadMember(auth.householdId, widget.memberId, typeKey: widget.typeKey);
    final from = _days == 0
        ? null
        : DateTime.now().subtract(Duration(days: _days)).toUtc().toIso8601String();
    final trend = await provider.trends(widget.memberId, typeKey: widget.typeKey, from: from);
    if (!mounted) return;
    setState(() {
      _trend = trend;
      _loading = false;
    });
  }

  bool _canEditTarget(AuthProvider auth) {
    if (auth.isSupervisor) return true;
    return auth.roles.contains(RoleNames.unsupervised) &&
        widget.memberId == auth.currentMemberId;
  }

  Future<void> _editTarget(MeasurementTarget? current) async {
    final minC = TextEditingController(text: current?.minTarget?.toString() ?? '');
    final maxC = TextEditingController(text: current?.maxTarget?.toString() ?? '');
    final goalC = TextEditingController(text: current?.goalValue?.toString() ?? '');
    final saved = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Target range'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: minC,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(labelText: 'Min'),
            ),
            TextField(
              controller: maxC,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(labelText: 'Max'),
            ),
            TextField(
              controller: goalC,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(labelText: 'Goal (optional)'),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Save')),
        ],
      ),
    );
    if (saved != true || !mounted) return;
    final ok = await context.read<BiometricProvider>().upsertTarget(widget.memberId, widget.typeKey, {
      'minTarget': double.tryParse(minC.text.trim()),
      'maxTarget': double.tryParse(maxC.text.trim()),
      'goalValue': double.tryParse(goalC.text.trim()),
    });
    if (ok && mounted) _reload();
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final provider = context.watch<BiometricProvider>();
    final type = provider.typeByKey(widget.typeKey);
    final target = provider.targetByKey(widget.typeKey);
    final bandLow = target?.minTarget ?? type?.minNormal;
    final bandHigh = target?.maxTarget ?? type?.maxNormal;
    final precision = type?.precision ?? 1;

    return Scaffold(
      appBar: AppBar(
        title: Text(type?.displayName ?? 'Trend'),
        actions: [
          if (_canEditTarget(auth))
            IconButton(
              tooltip: 'Set target',
              icon: const Icon(Icons.flag_outlined),
              onPressed: () => _editTarget(target),
            ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                SegmentedButton<int>(
                  segments: const [
                    ButtonSegment(value: 7, label: Text('7d')),
                    ButtonSegment(value: 30, label: Text('30d')),
                    ButtonSegment(value: 90, label: Text('90d')),
                    ButtonSegment(value: 0, label: Text('All')),
                  ],
                  selected: {_days},
                  onSelectionChanged: (s) {
                    setState(() => _days = s.first);
                    _reload();
                  },
                ),
                const SizedBox(height: 16),
                VitalsTrendChart(
                  series: _trend?.series ?? const [],
                  dual: type?.isDual ?? false,
                  bandLow: bandLow,
                  bandHigh: bandHigh,
                ),
                const SizedBox(height: 16),
                _Summary(trend: _trend, precision: precision),
              ],
            ),
    );
  }
}

class _Summary extends StatelessWidget {
  final MeasurementTrend? trend;
  final int precision;

  const _Summary({required this.trend, required this.precision});

  @override
  Widget build(BuildContext context) {
    final t = trend;
    if (t == null || t.count == 0) {
      return const Card(
        child: Padding(
          padding: EdgeInsets.all(16),
          child: Text('No readings in this range.'),
        ),
      );
    }
    String f(double? v) => v == null ? '—' : v.toStringAsFixed(precision);
    final rows = <(String, String)>[
      ('Latest', t.latest == null ? '—' : f(t.latest!.value)),
      ('Min', f(t.min)),
      ('Max', f(t.max)),
      ('Average', f(t.avg)),
      ('Count', '${t.count}'),
      ('Adherence', '${t.adherencePct.toStringAsFixed(1)}%'),
    ];
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            for (final r in rows)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(r.$1, style: Theme.of(context).textTheme.bodyMedium),
                    Text(r.$2, style: Theme.of(context).textTheme.titleSmall),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}
