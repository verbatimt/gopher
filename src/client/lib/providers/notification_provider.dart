import 'dart:async';

import '../models/app_notification.dart';
import '../services/notification_service.dart';
import 'base_provider.dart';

/// Notification center state: the list, the unread count, and live appends from the WS
/// `notification.new` event (bound via [bindEvents]).
class NotificationProvider extends BaseProvider {
  final NotificationService _service;
  StreamSubscription<Map<String, dynamic>>? _wsSub;

  List<AppNotification> _items = [];
  int _unreadCount = 0;

  NotificationProvider(this._service);

  List<AppNotification> get items => List.unmodifiable(_items);
  int get unreadCount => _unreadCount;

  Future<void> load() async {
    final page = await runGuarded(() => _service.fetch());
    if (page != null) {
      _items = page.items;
      _unreadCount = page.unreadCount;
      notifyListeners();
    }
  }

  Future<void> markRead(List<String> ids) async {
    if (ids.isEmpty) return;
    final updated = await runGuarded(() => _service.markRead(ids));
    if (updated == null) return;
    _items = _items
        .map((n) => ids.contains(n.id) ? n.copyWith(isRead: true) : n)
        .toList();
    _unreadCount = _items.where((n) => !n.isRead).length;
    notifyListeners();
  }

  Future<void> markAllRead() async {
    final unreadIds = _items.where((n) => !n.isRead).map((n) => n.id).toList();
    await markRead(unreadIds);
  }

  /// Listen to the WS event stream; prepend live notifications and bump the badge.
  void bindEvents(Stream<Map<String, dynamic>> events) {
    _wsSub?.cancel();
    _wsSub = events.listen((event) {
      if (event['type'] != 'notification.new') return;
      final payload = (event['payload'] as Map?)?.cast<String, dynamic>();
      if (payload == null) return;
      final notification = AppNotification.fromJson({...payload, 'isRead': false});
      _items = [notification, ..._items];
      _unreadCount += 1;
      notifyListeners();
    });
  }

  void reset() {
    _items = [];
    _unreadCount = 0;
    notifyListeners();
  }

  @override
  void dispose() {
    _wsSub?.cancel();
    super.dispose();
  }
}
