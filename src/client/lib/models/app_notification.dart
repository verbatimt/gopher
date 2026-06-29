/// An in-app notification (named `AppNotification` to avoid clashing with Flutter's
/// `Notification` class).
class AppNotification {
  final String id;
  final String type;
  final String title;
  final String? body;
  final bool isRead;
  final DateTime? createdAt;

  const AppNotification({
    required this.id,
    required this.type,
    required this.title,
    this.body,
    required this.isRead,
    this.createdAt,
  });

  AppNotification copyWith({bool? isRead}) => AppNotification(
        id: id,
        type: type,
        title: title,
        body: body,
        isRead: isRead ?? this.isRead,
        createdAt: createdAt,
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
    );
  }
}
