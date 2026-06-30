import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../models/audit.dart';
import '../../providers/audit_provider.dart';
import '../../providers/auth_provider.dart';
import '../../widgets/empty_state.dart';

/// Household activity log (EP-0051): a read-only viewer over the action log and value-change
/// history. Restricted to supervisors (the server also denies others with 403).
class AuditLogScreen extends StatefulWidget {
  const AuditLogScreen({super.key});

  @override
  State<AuditLogScreen> createState() => _AuditLogScreenState();
}

class _AuditLogScreenState extends State<AuditLogScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final auth = context.read<AuthProvider>();
      if (auth.householdId.isNotEmpty) context.read<AuditProvider>().load(auth.householdId);
    });
  }

  String _ts(DateTime d) {
    final l = d.toLocal();
    return '${l.year}-${l.month.toString().padLeft(2, '0')}-${l.day.toString().padLeft(2, '0')} '
        '${l.hour.toString().padLeft(2, '0')}:${l.minute.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    if (!auth.isSupervisor) {
      return Scaffold(
        appBar: AppBar(title: const Text('Activity log')),
        body: const Center(child: Text('Only supervisors can view the activity log.')),
      );
    }
    final provider = context.watch<AuditProvider>();

    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Activity log'),
          bottom: const TabBar(tabs: [Tab(text: 'Actions'), Tab(text: 'Changes')]),
        ),
        body: TabBarView(
          children: [
            _actionsTab(provider, auth),
            _changesTab(provider, auth),
          ],
        ),
      ),
    );
  }

  Widget _actionsTab(AuditProvider provider, AuthProvider auth) {
    if (provider.logs.isEmpty) {
      return const EmptyState(
        icon: Icons.fact_check_outlined,
        title: 'No activity',
        message: 'Audited actions will appear here.',
      );
    }
    return RefreshIndicator(
      onRefresh: () => provider.load(auth.householdId),
      child: ListView(
        children: [
          for (final AuditLogEntry e in provider.logs)
            ListTile(
              leading: const Icon(Icons.history),
              title: Text(e.actionLabel),
              subtitle: Text([
                if (e.actorName != null) 'by ${e.actorName}',
                _ts(e.createdAt),
                if (e.ipAddress != null) e.ipAddress!,
              ].join(' · ')),
            ),
        ],
      ),
    );
  }

  Widget _changesTab(AuditProvider provider, AuthProvider auth) {
    if (provider.changes.isEmpty) {
      return const EmptyState(
        icon: Icons.compare_arrows,
        title: 'No changes',
        message: 'Tracked field changes will appear here.',
      );
    }
    return RefreshIndicator(
      onRefresh: () => provider.load(auth.householdId),
      child: ListView(
        children: [
          for (final ValueChangeEntry c in provider.changes)
            ListTile(
              leading: Icon(c.redacted ? Icons.lock_outline : Icons.edit_note),
              title: Text('${c.entityType} · ${c.fieldName}'),
              subtitle: Text([
                '${c.oldValue ?? '∅'} → ${c.newValue ?? '∅'}',
                if (c.changedByName != null) 'by ${c.changedByName}',
                _ts(c.createdAt),
              ].join(' · ')),
            ),
        ],
      ),
    );
  }
}
