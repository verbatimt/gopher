import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../models/biometric.dart';
import '../../providers/auth_provider.dart';
import '../../providers/biometric_provider.dart';
import '../../widgets/empty_state.dart';

/// Measurement history for a member (EP-0044), filterable by type and date range. Tap a row to
/// edit; the overflow menu deletes (both role-enforced server-side).
class MeasurementListScreen extends StatefulWidget {
  final String memberId;

  const MeasurementListScreen({super.key, required this.memberId});

  @override
  State<MeasurementListScreen> createState() => _MeasurementListScreenState();
}

class _MeasurementListScreenState extends State<MeasurementListScreen> {
  String? _typeKey; // null ⇒ all
  int _days = 30; // 0 ⇒ all time

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _reload());
  }

  Future<void> _reload() async {
    final auth = context.read<AuthProvider>();
    final provider = context.read<BiometricProvider>();
    if (provider.types.isEmpty) await provider.loadTypes(auth.householdId);
    final from = _days == 0
        ? null
        : DateTime.now().subtract(Duration(days: _days)).toUtc().toIso8601String();
    await provider.loadMember(auth.householdId, widget.memberId, typeKey: _typeKey, from: from);
  }

  Future<void> _delete(Measurement m) async {
    final ok = await context.read<BiometricProvider>().deleteMeasurement(widget.memberId, m.id);
    if (!mounted) return;
    if (!ok) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.read<BiometricProvider>().error ?? 'Delete failed.')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<BiometricProvider>();
    final rows = provider.measurements;

    return Scaffold(
      appBar: AppBar(title: const Text('History')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(12),
            child: Row(
              children: [
                Expanded(
                  child: DropdownButtonFormField<String?>(
                    initialValue: _typeKey,
                    decoration: const InputDecoration(labelText: 'Type', border: OutlineInputBorder()),
                    items: [
                      const DropdownMenuItem(value: null, child: Text('All types')),
                      for (final t in provider.types)
                        DropdownMenuItem(value: t.key, child: Text(t.displayName)),
                    ],
                    onChanged: (v) {
                      setState(() => _typeKey = v);
                      _reload();
                    },
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: DropdownButtonFormField<int>(
                    initialValue: _days,
                    decoration: const InputDecoration(labelText: 'Range', border: OutlineInputBorder()),
                    items: const [
                      DropdownMenuItem(value: 7, child: Text('7 days')),
                      DropdownMenuItem(value: 30, child: Text('30 days')),
                      DropdownMenuItem(value: 90, child: Text('90 days')),
                      DropdownMenuItem(value: 0, child: Text('All time')),
                    ],
                    onChanged: (v) {
                      setState(() => _days = v ?? 30);
                      _reload();
                    },
                  ),
                ),
              ],
            ),
          ),
          Expanded(
            child: rows.isEmpty
                ? const EmptyState(
                    icon: Icons.timeline_outlined,
                    title: 'No readings',
                    message: 'No measurements match this filter.',
                  )
                : RefreshIndicator(
                    onRefresh: _reload,
                    child: ListView.builder(
                      itemCount: rows.length,
                      itemBuilder: (context, i) => _Row(
                        measurement: rows[i],
                        type: provider.typeByKey(rows[i].typeKey ?? ''),
                        onEdit: () async {
                          final changed = await context.push<bool>(
                            '/health/record?memberId=${widget.memberId}',
                            extra: rows[i],
                          );
                          if (changed == true) _reload();
                        },
                        onDelete: () => _delete(rows[i]),
                      ),
                    ),
                  ),
          ),
        ],
      ),
    );
  }
}

class _Row extends StatelessWidget {
  final Measurement measurement;
  final MeasurementType? type;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  const _Row({
    required this.measurement,
    required this.type,
    required this.onEdit,
    required this.onDelete,
  });

  @override
  Widget build(BuildContext context) {
    final precision = type?.precision ?? 1;
    final v = measurement.value.toStringAsFixed(precision);
    final label = (type?.isDual ?? false) && measurement.valueSecondary != null
        ? '$v/${measurement.valueSecondary!.toStringAsFixed(precision)} ${measurement.unit}'
        : '$v ${measurement.unit}';
    final when = measurement.measuredAt.toLocal();
    return ListTile(
      title: Text('${type?.displayName ?? measurement.typeKey ?? 'Reading'} · $label'),
      subtitle: Text(
        '${when.year}-${when.month.toString().padLeft(2, '0')}-${when.day.toString().padLeft(2, '0')} '
        '${when.hour.toString().padLeft(2, '0')}:${when.minute.toString().padLeft(2, '0')}'
        '${measurement.notes != null ? ' · ${measurement.notes}' : ''}',
      ),
      onTap: onEdit,
      trailing: PopupMenuButton<String>(
        onSelected: (s) => s == 'edit' ? onEdit() : onDelete(),
        itemBuilder: (context) => const [
          PopupMenuItem(value: 'edit', child: Text('Edit')),
          PopupMenuItem(value: 'delete', child: Text('Delete')),
        ],
      ),
    );
  }
}
