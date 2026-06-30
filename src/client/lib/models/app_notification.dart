/// An in-app notification (named `AppNotification` to avoid clashing with Flutter's
/// `Notification` class).
class AppNotification {
  final String id;
  final String type;
  final String title;
  final String? body;
  final bool isRead;
  final DateTime? createdAt;

  /// Polymorphic link back to the originating entity, used for tap-to-navigate.
  final String? sourceEntityType;
  final String? sourceEntityId;

  const AppNotification({
    required this.id,
    required this.type,
    required this.title,
    this.body,
    required this.isRead,
    this.createdAt,
    this.sourceEntityType,
    this.sourceEntityId,
  });

  AppNotification copyWith({bool? isRead}) => AppNotification(
        id: id,
        type: type,
        title: title,
        body: body,
        isRead: isRead ?? this.isRead,
        createdAt: createdAt,
        sourceEntityType: sourceEntityType,
        sourceEntityId: sourceEntityId,
      );

  factory AppNotification.fromJson(Map<String, dynamic> json) {
    final created = json['createdAt'] as String?;
    return AppNotification(
      id: json['id'] as String,
      type: json['type'] as String? ?? '',
      title: json['title'] as String? ?? '',
      body: json['body'] as String?,
      isRead: json['isRead'] as bool? ?? false,
      createdAt: created != null ? DateTime.tryParse(created) : null,
      sourceEntityType: json['sourceEntityType'] as String?,
      sourceEntityId: json['sourceEntityId'] as String?,
    );
  }

  /// The in-app `go_router` location this notification deep-links to, or null if it isn't
  /// routable. Prefers the explicit source entity (type + id); falls back to the
  /// notification type family (e.g. `task.due` → tasks) so list-level routing still works
  /// when no source id was attached.
  String? get targetRoute {
    final id = sourceEntityId;
    switch (sourceEntityType) {
      case 'task':
        return id != null ? '/tasks/$id' : '/tasks';
      case 'medication_schedule':
        return id != null ? '/medications/$id' : '/medications';
      case 'reward_transaction':
        return '/rewards';
      case 'measurement':
        return '/health/trends';
    }
    switch (type.split('.').first) {
      case 'task':
        return id != null ? '/tasks/$id' : '/tasks';
      case 'medication':
        return id != null ? '/medications/$id' : '/medications';
      case 'reward':
        return '/rewards';
      case 'calendar':
        return '/calendar';
      case 'invitation':
        return '/members';
      case 'vitals':
        return '/health/trends';
    }
    return null;
  }
}
