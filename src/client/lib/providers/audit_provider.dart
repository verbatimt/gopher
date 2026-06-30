import '../models/audit.dart';
import '../services/audit_service.dart';
import 'base_provider.dart';

/// Activity-log state (EP-0051): the household action log + value-change history. Read-only.
class AuditProvider extends BaseProvider {
  final AuditService _service;

  List<AuditLogEntry> _logs = [];
  List<ValueChangeEntry> _changes = [];

  AuditProvider(this._service);

  List<AuditLogEntry> get logs => List.unmodifiable(_logs);
  List<ValueChangeEntry> get changes => List.unmodifiable(_changes);

  Future<void> load(String householdId, {String? action}) async {
    final result = await runGuarded(() async {
      final logs = await _service.auditLogs(householdId, action: action);
      final changes = await _service.valueChanges(householdId);
      return (logs, changes);
    });
    if (result != null) {
      _logs = result.$1;
      _changes = result.$2;
      notifyListeners();
    }
  }
}
