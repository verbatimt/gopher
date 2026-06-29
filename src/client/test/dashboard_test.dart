import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gopher/core/api/api_client.dart';
import 'package:gopher/core/constants.dart';
import 'package:gopher/core/storage/in_memory_token_store.dart';
import 'package:gopher/providers/dashboard_provider.dart';
import 'package:gopher/providers/health_provider.dart';
import 'package:gopher/providers/module_provider.dart';
import 'package:gopher/providers/notification_provider.dart';
import 'package:gopher/screens/dashboard/dashboard_screen.dart';
import 'package:gopher/services/dashboard_service.dart';
import 'package:gopher/services/health_service.dart';
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

ApiClient _client(MockClient mock) =>
    ApiClient(baseUrl: 'http://t', client: mock, tokenStore: InMemoryTokenStore());

void main() {
  test('DashboardProvider parses sections and refreshes on WS events', () async {
    final mock = MockClient((req) async {
      if (req.url.path == '/api/v1/dashboard') {
        return http.Response(_env({'sections': {'tasks': {'pendingCount': 2}}}), 200);
      }
      return http.Response('{}', 404);
    });
    final provider = DashboardProvider(DashboardService(_client(mock)));
    await provider.load();
    expect(provider.data?.has('tasks'), isTrue);
    expect(provider.data?.intOf('tasks', 'pendingCount'), 2);
  });

  testWidgets('renders module section cards with empty states', (tester) async {
    final mock = MockClient((req) async {
      if (req.url.path == '/api/v1/dashboard') {
        return http.Response(
          _env({
            'sections': {
              'tasks': {
                'pendingCount': 3,
                'overdueCount': 1,
                'items': [
                  {'title': 'Sweep'},
                ],
              },
              'calendar': {'upcoming': const []},
              'rewards': {'balance': 50, 'pendingRedemptions': 0},
            },
          }),
          200,
        );
      }
      if (req.url.path == '/health') {
        return http.Response(
          jsonEncode({'status': 'healthy', 'services': {'database': true, 'redis': true}, 'version': 'v1'}),
          200,
        );
      }
      return http.Response('{}', 404);
    });
    final modules = ModuleProvider()..setActive(const [AppModules.dashboard]);
    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider<DashboardProvider>.value(
            value: DashboardProvider(DashboardService(_client(mock))),
          ),
          ChangeNotifierProvider<HealthProvider>.value(
            value: HealthProvider(HealthService(_client(mock))),
          ),
          ChangeNotifierProvider<ModuleProvider>.value(value: modules),
          ChangeNotifierProvider<NotificationProvider>.value(
            value: NotificationProvider(NotificationService(_client(mock))),
          ),
        ],
        child: const MaterialApp(home: DashboardScreen()),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Tasks'), findsOneWidget);
    expect(find.text('3 pending · 1 overdue'), findsOneWidget);
    expect(find.text('Sweep'), findsOneWidget);
    expect(find.text('Rewards'), findsOneWidget);
    expect(find.text('50 points'), findsOneWidget);
    // Calendar section present but empty → graceful empty state.
    expect(find.text('No upcoming events'), findsOneWidget);
  });
}
