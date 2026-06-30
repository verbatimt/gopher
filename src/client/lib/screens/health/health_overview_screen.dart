import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../core/constants.dart';
import '../../models/biometric.dart';
import '../../providers/auth_provider.dart';
import '../../providers/biometric_provider.dart';
import '../../providers/household_provider.dart';
import '../../widgets/empty_state.dart';
import '../../widgets/list_detail_layout.dart';
import '../../widgets/module_guard.dart';
import '../../widgets/status_badge.dart';
import 'measurement_trends_screen.dart';

/// Per-member vitals overview (EP-0044): a card per measurement type with the latest reading
/// and an in/out-of-range badge. Supervisors can switch member; everyone else is pinned to
/// their own profile.
class HealthOverviewScreen extends StatefulWidget {
  const HealthOverviewScreen({super.key});

  @override
  State<HealthOverviewScreen> createState() => _HealthOverviewScreenState();
}

class _HealthOverviewScreenState extends State<HealthOverviewScreen> {
  String? _memberId;
  String? _selectedTypeKey;

  void _openType(String typeKey, bool isTwoPane) {
    if (isTwoPane) {
      setState(() => _selectedTypeKey = typeKey);
    } else {
      context.push('/health/trends?memberId=$_memberId&typeKey=$typeKey');
    }
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _bootstrap());
  }

  Future<void> _bootstrap() async {
    final auth = context.read<AuthProvider>();
    final provider = context.read<BiometricProvider>();
    final household = context.read<HouseholdProvider>();
    if (auth.householdId.isEmpty) return;
    await provider.loadTypes(auth.householdId);
    // Resolve the member to show: supervisors default to themselves but may switch.
    final mine = await auth.ensureMemberId();
    var target = mine;
    if (auth.isSupervisor && target == null && household.members.isNotEmpty) {
      target = household.members.first.id;
    }
    if (target != null && mounted) {
      setState(() => _memberId = target);
      await provider.loadMember(auth.householdId, target);
    }
  }

  Future<void> _switchMember(String memberId) async {
    final auth = context.read<AuthProvider>();
    setState(() => _memberId = memberId);
    await context.read<BiometricProvider>().loadMember(auth.householdId, memberId);
  }

  /// Range verdict for the latest reading vs target (or normal band): in/out/none.
  (String, StatusTone)? _badge(MeasurementType type, Measurement? latest, MeasurementTarget? target) {
    if (latest == null) return null;
    final lo = target?.minTarget ?? type.minNormal;
    final hi = target?.maxTarget ?? type.maxNormal;
    if (lo == null && hi == null) return null;
    final v = latest.value;
    final inRange = (lo == null || v >= lo) && (hi == null || v <= hi);
    return inRange ? ('In range', StatusTone.success) : ('Out of range', StatusTone.warning);
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final provider = context.watch<BiometricProvider>();
    final latest = provider.latestByType;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Health & vitals'),
        actions: [
          if (_memberId != null)
            IconButton(
              tooltip: 'History',
              icon: const Icon(Icons.history),
              onPressed: () => context.push('/health/history?memberId=$_memberId'),
            ),
        ],
      ),
      floatingActionButton: _memberId == null
          ? null
          : FloatingActionButton.extended(
              onPressed: () async {
                final provider = context.read<BiometricProvider>();
                final mid = _memberId;
                await context.push('/health/record?memberId=$mid');
                if (!mounted || mid == null) return;
                await provider.loadMember(auth.householdId, mid);
              },
              icon: const Icon(Icons.add),
              label: const Text('Record'),
            ),
      body: ModuleGuard(
        module: AppModules.health,
        child: ListDetailLayout(
          listBuilder: (context, isTwoPane) => Column(
            children: [
              if (auth.isSupervisor) _MemberSwitcher(selected: _memberId, onChanged: _switchMember),
              Expanded(
                child: provider.types.isEmpty
                    ? const EmptyState(
                        icon: Icons.favorite_outline,
                        title: 'No measurement types',
                        message: 'No vitals types are configured for this household.',
                      )
                    : RefreshIndicator(
                        onRefresh: () => _memberId == null
                            ? Future.value()
                            : provider.loadMember(auth.householdId, _memberId!),
                        child: ListView(
                          padding: const EdgeInsets.all(12),
                          children: [
                            for (final type in provider.types)
                              _TypeCard(
                                type: type,
                                latest: latest[type.key],
                                badge: _badge(type, latest[type.key], provider.targetByKey(type.key)),
                                selected: isTwoPane && type.key == _selectedTypeKey,
                                onTap: _memberId == null
                                    ? null
                                    : () => _openType(type.key, isTwoPane),
                              ),
                          ],
                        ),
                      ),
              ),
            ],
          ),
          detail: (_selectedTypeKey == null || _memberId == null)
              ? null
              : MeasurementTrendsView(
                  key: ValueKey('$_memberId/$_selectedTypeKey'),
                  memberId: _memberId!,
                  typeKey: _selectedTypeKey!,
                  showHeader: true,
                ),
          placeholder: const DetailPanePlaceholder(
            message: 'Select a measurement to see its trend.',
          ),
        ),
      ),
    );
  }
}

class _MemberSwitcher extends StatelessWidget {
  final String? selected;
  final ValueChanged<String> onChanged;

  const _MemberSwitcher({required this.selected, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    final members = context.watch<HouseholdProvider>().members;
    if (members.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 12, 12, 0),
      child: DropdownButtonFormField<String>(
        initialValue: selected,
        decoration: const InputDecoration(labelText: 'Member', border: OutlineInputBorder()),
        items: [
          for (final m in members) DropdownMenuItem(value: m.id, child: Text(m.displayName)),
        ],
        onChanged: (v) {
          if (v != null) onChanged(v);
        },
      ),
    );
  }
}

class _TypeCard extends StatelessWidget {
  final MeasurementType type;
  final Measurement? latest;
  final (String, StatusTone)? badge;
  final bool selected;
  final VoidCallback? onTap;

  const _TypeCard({
    required this.type,
    this.latest,
    this.badge,
    this.selected = false,
    this.onTap,
  });

  String _value(Measurement m) {
    final v = m.value.toStringAsFixed(type.precision);
    if (type.isDual && m.valueSecondary != null) {
      return '$v/${m.valueSecondary!.toStringAsFixed(type.precision)} ${m.unit}';
    }
    return '$v ${m.unit}';
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      child: ListTile(
        selected: selected,
        leading: const Icon(Icons.monitor_heart_outlined),
        title: Text(type.displayName),
        subtitle: Text(
          latest == null
              ? 'No readings yet'
              : '${_value(latest!)} · ${_relative(latest!.measuredAt)}',
          style: theme.textTheme.bodySmall,
        ),
        trailing: badge == null
            ? const Icon(Icons.chevron_right)
            : Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  StatusBadge(badge!.$1, tone: badge!.$2),
                  const SizedBox(width: 4),
                  const Icon(Icons.chevron_right),
                ],
              ),
        onTap: onTap,
      ),
    );
  }
}

String _relative(DateTime when) {
  final d = DateTime.now().difference(when);
  if (d.inDays > 0) return '${d.inDays}d ago';
  if (d.inHours > 0) return '${d.inHours}h ago';
  if (d.inMinutes > 0) return '${d.inMinutes}m ago';
  return 'just now';
}
