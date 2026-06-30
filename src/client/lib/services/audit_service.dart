import '../core/api/api_client.dart';
import '../models/audit.dart';

/// Transport for the audit read API (EP-0051).
class AuditService {
  final ApiClient _api;

  AuditService(this._api);

  String _base(String householdId) => '/api/v1/households/$householdId';

  Future<List<AuditLogEntry>> auditLogs(String householdId, {String? action}) {
    final q = action != null && action.isNotEmpty ? '?action=${Uri.encodeQueryComponent(action)}' : '';
    return _api.getEnveloped('${_base(householdId)}/audit-logs$q', (r) {
      final list = (r as Map)['logs'] as List;
      return list.map((e) => AuditLogEntry.fromJson((e as Map).cast<String, dynamic>())).toList();
    });
  }

  Future<List<ValueChangeEntry>> valueChanges(
    String householdId, {
    String? entityType,
    String? entityId,
  }) {
    final params = <String>[];
    if (entityType != null && entityType.isNotEmpty) params.add('entityType=$entityType');
    if (entityId != null && entityId.isNotEmpty) params.add('entityId=$entityId');
    final q = params.isEmpty ? '' : '?${params.join('&')}';
    return _api.getEnveloped('${_base(householdId)}/value-change-history$q', (r) {
      final list = (r as Map)['changes'] as List;
      return list.map((e) => ValueChangeEntry.fromJson((e as Map).cast<String, dynamic>())).toList();
    });
  }
}
