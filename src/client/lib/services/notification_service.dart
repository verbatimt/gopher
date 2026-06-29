import '../core/api/api_client.dart';
import '../models/app_notification.dart';

class NotificationPage {
  final List<AppNotification> items;
  final int unreadCount;

  const NotificationPage({required this.items, required this.unreadCount});
}

class NotificationService {
  final ApiClient _api;

  NotificationService(this._api);

  Future<NotificationPage> fetch({bool? isRead, int page = 1}) {
    final params = <String>['page=$page', if (isRead != null) 'isRead=$isRead'];
    return _api.getEnveloped('/api/v1/notifications?${params.join('&')}', (r) {
      final map = r as Map;
      final list = (map['notifications'] as List)
          .map((e) => AppNotification.fromJson((e as Map).cast<String, dynamic>()))
          .toList();
      return NotificationPage(items: list, unreadCount: (map['unreadCount'] as num?)?.toInt() ?? 0);
    });
  }

  Future<int> markRead(List<String> ids) {
    return _api.postEnveloped(
      '/api/v1/notifications/read',
      {'ids': ids},
      (r) => ((r as Map)['updated'] as num?)?.toInt() ?? 0,
    );
  }
}
