import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gopher/core/api/api_client.dart';
import 'package:gopher/core/storage/in_memory_token_store.dart';
import 'package:gopher/providers/audit_provider.dart';
import 'package:gopher/providers/auth_provider.dart';
import 'package:gopher/screens/settings/audit_log_screen.dart';
import 'package:gopher/services/audit_service.dart';
import 'package:gopher/services/auth_service.dart';
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

String _jwt(Map<String, dynamic> claims) {
  String seg(Map<String, dynamic> m) =>
      base64Url.encode(utf8.encode(jsonEncode(m))).replaceAll('=', '');
  return '${seg({'alg': 'none'})}.${seg(claims)}.sig';
}

void main() {
  test('AuditProvider load populates logs + changes', () async {
    final mock = MockClient((req) async {
      if (req.url.path == '/api/v1/households/h/audit-logs') {
        return http.Response(
          _env({
            'logs': [
              {'id': '1', 'action': 'household.invite_created', 'actionLabel': 'Household · invite created', 'actorName': 'Owner', 'createdAt': '2026-01-01T00:00:00.000Z'},
            ],
          }),
          200,
        );
      }
      if (req.url.path == '/api/v1/households/h/value-change-history') {
        return http.Response(
          _env({
            'changes': [
              {'id': 'c1', 'entityType': 'biometric_measurement', 'fieldName': 'valueNumeric', 'oldValue': '<hidden>', 'newValue': '<hidden>', 'redacted': true, 'createdAt': '2026-01-01T00:00:00.000Z'},
            ],
          }),
          200,
        );
      }
      return http.Response('{}', 404);
    });
    final provider = AuditProvider(AuditService(_client(mock)));
    await provider.load('h');
    expect(provider.logs.length, 1);
    expect(provider.logs.first.actionLabel, contains('invite created'));
    expect(provider.changes.first.redacted, isTrue);
  });

  Future<AuthProvider> authWith(String role) async {
    final store = InMemoryTokenStore();
    final mock = MockClient((req) async {
      if (req.url.path == '/api/v1/auth/login') {
        return http.Response(
          _env({
            'accessToken': _jwt({'householdId': 'h', 'roles': role}),
            'user': {'id': 'u', 'email': 'a@b.c', 'displayName': 'Owner'},
          }),
          200,
        );
      }
      return http.Response('{}', 404);
    });
    final auth = AuthProvider(
      tokenStore: store,
      authService: AuthService(ApiClient(baseUrl: 'http://t', client: mock, tokenStore: store)),
    );
    await auth.login('a@b.c', 'pw');
    return auth;
  }

  Widget wrap(AuthProvider auth, MockClient mock) => MultiProvider(
        providers: [
          ChangeNotifierProvider<AuthProvider>.value(value: auth),
          ChangeNotifierProvider<AuditProvider>.value(
            value: AuditProvider(AuditService(_client(mock))),
          ),
        ],
        child: const MaterialApp(home: AuditLogScreen()),
      );

  testWidgets('supervisor sees the activity log; supervised is blocked', (tester) async {
    final logMock = MockClient((req) async {
      if (req.url.path.endsWith('/audit-logs')) {
        return http.Response(
          _env({
            'logs': [
              {'id': '1', 'action': 'household.settings_updated', 'actionLabel': 'Household · settings updated', 'actorName': 'Owner', 'createdAt': '2026-01-01T00:00:00.000Z'},
            ],
          }),
          200,
        );
      }
      return http.Response(_env({'changes': const []}), 200);
    });

    final sup = await authWith('supervising_user');
    await tester.pumpWidget(wrap(sup, logMock));
    await tester.pumpAndSettle();
    expect(find.text('Household · settings updated'), findsOneWidget);

    final kid = await authWith('supervised_user');
    await tester.pumpWidget(wrap(kid, logMock));
    await tester.pumpAndSettle();
    expect(find.textContaining('Only supervisors'), findsOneWidget);
  });
}
