import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:gopher/core/api/api_client.dart';
import 'package:gopher/core/storage/in_memory_token_store.dart';
import 'package:gopher/providers/notification_provider.dart';
import 'package:gopher/screens/notifications/notifications_screen.dart';
import 'package:gopher/services/notification_service.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';

String _env(Object? result) => jsonEncode({
      'version': 'v1',
      'statusCode': 200,
      'success': true,
      'message': 'OK',
      'result': result,
    });

/// Provider over a MockClient that serves one routable (task) notification and the
/// mark-read endpoint.
NotificationProvider _provider(List<String> readCalls) {
  final mock = MockClient((req) async {
    if (req.url.path == '/api/v1/notifications' && req.method == 'GET') {
      return http.Response(
        _env({
          'notifications': [
            {
              'id': 'n1',
              'type': 'task.due',
              'title': 'Task due',
              'isRead': false,
              'sourceEntityType': 'task',
              'sourceEntityId': 't1',
            },
          ],
          'unreadCount': 1,
        }),
        200,
      );
    }
    if (req.url.path == '/api/v1/notifications/read' && req.method == 'POST') {
      readCalls.add(req.body);
      return http.Response(_env({'updated': 1}), 200);
    }
    return http.Response('{}', 404);
  });
  final api = ApiClient(baseUrl: 'http://t', client: mock, tokenStore: InMemoryTokenStore());
  return NotificationProvider(NotificationService(api));
}

Widget _host(NotificationProvider provider) {
  final router = GoRouter(
    initialLocation: '/notifications',
    routes: [
      GoRoute(path: '/notifications', builder: (c, s) => const NotificationsScreen()),
      GoRoute(
        path: '/tasks/:taskId',
        builder: (c, s) => Scaffold(body: Text('TASK ${s.pathParameters['taskId']}')),
      ),
    ],
  );
  return ChangeNotifierProvider<NotificationProvider>.value(
    value: provider,
    child: MaterialApp.router(routerConfig: router),
  );
}

void main() {
  testWidgets('tapping a notification deep-links to its source entity and marks it read',
      (tester) async {
    final readCalls = <String>[];
    final provider = _provider(readCalls);
    await provider.load();

    await tester.pumpWidget(_host(provider));
    await tester.pumpAndSettle();

    expect(find.text('Task due'), findsOneWidget);

    await tester.tap(find.text('Task due'));
    await tester.pumpAndSettle();

    // Navigated to /tasks/t1 (the source entity) ...
    expect(find.text('TASK t1'), findsOneWidget);
    // ... and the notification was marked read.
    expect(readCalls.single, contains('n1'));
    expect(provider.unreadCount, 0);
  });
}
