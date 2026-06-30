import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:gopher/core/api/api_client.dart';
import 'package:gopher/core/storage/in_memory_token_store.dart';
import 'package:gopher/models/app_notification.dart';
import 'package:gopher/providers/notification_provider.dart';
import 'package:gopher/services/notification_service.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

String _env(Object? result) => jsonEncode({
      'version': 'v1',
      'statusCode': 200,
      'success': true,
      'message': 'OK',
      'result': result,
    });

NotificationProvider _provider(MockClient mock) {
  final store = InMemoryTokenStore();
  final api = ApiClient(baseUrl: 'http://t', client: mock, tokenStore: store);
  return NotificationProvider(NotificationService(api));
}

void main() {
  test('load fetches items and unread count', () async {
    final mock = MockClient((req) async {
      if (req.url.path == '/api/v1/notifications') {
        return http.Response(
          _env({
            'notifications': [
              {'id': 'n1', 'type': 'task.due', 'title': 'A', 'isRead': false},
              {'id': 'n2', 'type': 'task.due', 'title': 'B', 'isRead': true},
            ],
            'unreadCount': 1,
          }),
          200,
        );
      }
      return http.Response('{}', 404);
    });
    final provider = _provider(mock);
    await provider.load();
    expect(provider.items.length, 2);
    expect(provider.unreadCount, 1);
  });

  test('appends a live notification.new event and bumps the badge', () async {
    final mock = MockClient((req) async => http.Response('{}', 404));
    final provider = _provider(mock);
    final controller = StreamController<Map<String, dynamic>>();
    provider.bindEvents(controller.stream);

    controller.add({
      'type': 'notification.new',
      'payload': {'id': 'n9', 'type': 'task.assigned', 'title': 'New task'},
    });
    await Future<void>.delayed(Duration.zero);

    expect(provider.items.length, 1);
    expect(provider.items.first.id, 'n9');
    expect(provider.unreadCount, 1);
    await controller.close();
  });

  test('markAllRead marks every unread item read', () async {
    final mock = MockClient((req) async {
      if (req.url.path == '/api/v1/notifications') {
        return http.Response(
          _env({
            'notifications': [
              {'id': 'n1', 'type': 'task.due', 'title': 'A', 'isRead': false},
            ],
            'unreadCount': 1,
          }),
          200,
        );
      }
      if (req.url.path == '/api/v1/notifications/read') {
        return http.Response(_env({'updated': 1}), 200);
      }
      return http.Response('{}', 404);
    });
    final provider = _provider(mock);
    await provider.load();
    await provider.markAllRead();
    expect(provider.unreadCount, 0);
    expect(provider.items.first.isRead, isTrue);
  });

  group('AppNotification.targetRoute', () {
    AppNotification make({String type = 'task.due', String? entityType, String? entityId}) =>
        AppNotification(
          id: 'n',
          type: type,
          title: 't',
          isRead: false,
          sourceEntityType: entityType,
          sourceEntityId: entityId,
        );

    test('maps a source entity (type + id) to its detail route', () {
      expect(make(entityType: 'task', entityId: 't1').targetRoute, '/tasks/t1');
      expect(
        make(entityType: 'medication_schedule', entityId: 's1').targetRoute,
        '/medications/s1',
      );
      expect(make(entityType: 'reward_transaction', entityId: 'r1').targetRoute, '/rewards');
      expect(make(entityType: 'measurement', entityId: 'm1').targetRoute, '/health/trends');
    });

    test('falls back to the type family when no source entity is attached', () {
      expect(make(type: 'task.due').targetRoute, '/tasks');
      expect(make(type: 'medication.refill_needed').targetRoute, '/medications');
      expect(make(type: 'reward.earned').targetRoute, '/rewards');
      expect(make(type: 'calendar.reminder').targetRoute, '/calendar');
      expect(make(type: 'invitation.accepted').targetRoute, '/members');
    });

    test('returns null when nothing maps', () {
      expect(make(type: 'system.unknown').targetRoute, isNull);
    });
  });
}
