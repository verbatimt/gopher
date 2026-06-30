// Audit viewer models mirroring the EP-0051 read API.

class AuditLogEntry {
  final String id;
  final String action;
  final String actionLabel;
  final String? actorName;
  final String? entityType;
  final String? ipAddress;
  final DateTime createdAt;

  const AuditLogEntry({
    required this.id,
    required this.action,
    required this.actionLabel,
    this.actorName,
    this.entityType,
    this.ipAddress,
    required this.createdAt,
  });

  factory AuditLogEntry.fromJson(Map<String, dynamic> json) => AuditLogEntry(
        id: json['id'] as String,
        action: json['action'] as String? ?? '',
        actionLabel: json['actionLabel'] as String? ?? json['action'] as String? ?? '',
        actorName: json['actorName'] as String?,
        entityType: json['entityType'] as String?,
        ipAddress: json['ipAddress'] as String?,
        createdAt: DateTime.tryParse(json['createdAt'] as String? ?? '') ??
            DateTime.fromMillisecondsSinceEpoch(0),
      );
}

class ValueChangeEntry {
  final String id;
  final String entityType;
  final String fieldName;
  final String? oldValue;
  final String? newValue;
  final bool redacted;
  final String? changedByName;
  final DateTime createdAt;

  const ValueChangeEntry({
    required this.id,
    required this.entityType,
    required this.fieldName,
    this.oldValue,
    this.newValue,
    required this.redacted,
    this.changedByName,
    required this.createdAt,
  });

  factory ValueChangeEntry.fromJson(Map<String, dynamic> json) => ValueChangeEntry(
        id: json['id'] as String,
        entityType: json['entityType'] as String? ?? '',
        fieldName: json['fieldName'] as String? ?? '',
        oldValue: json['oldValue'] as String?,
        newValue: json['newValue'] as String?,
        redacted: json['redacted'] as bool? ?? false,
        changedByName: json['changedByName'] as String?,
        createdAt: DateTime.tryParse(json['createdAt'] as String? ?? '') ??
            DateTime.fromMillisecondsSinceEpoch(0),
      );
}
