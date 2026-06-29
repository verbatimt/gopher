import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gopher/core/api/api_client.dart';
import 'package:gopher/core/constants.dart';
import 'package:gopher/core/storage/in_memory_token_store.dart';
import 'package:gopher/providers/auth_provider.dart';
import 'package:gopher/providers/budget_provider.dart';
import 'package:gopher/providers/module_provider.dart';
import 'package:gopher/screens/finances/budgets_screen.dart';
import 'package:gopher/services/auth_service.dart';
import 'package:gopher/services/budget_service.dart';
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

MockClient _budgetMock() => MockClient((req) async {
      final p = req.url.path;
      if (p == '/api/v1/households/h/budgets') {
        return http.Response(
          _env({'budgets': [
            {'id': 'b1', 'name': 'March', 'period': 'monthly', 'startDate': '2026-03-01'},
          ]}),
          200,
        );
      }
      if (p == '/api/v1/households/h/budgets/b1') {
        return http.Response(
          _env({'budget': {'id': 'b1'}, 'categories': [
            {'id': 'c1', 'name': 'Food', 'targetAmount': '200.00'},
          ]}),
          200,
        );
      }
      if (p == '/api/v1/households/h/budgets/b1/summary') {
        return http.Response(
          _env({'categories': [
            {'categoryId': 'c1', 'name': 'Food', 'target': 200, 'actual': 100, 'remaining': 100},
          ]}),
          200,
        );
      }
      if (p == '/api/v1/households/h/expenses') {
        return http.Response(_env({'expenses': const []}), 200);
      }
      return http.Response('{}', 404);
    });

void main() {
  test('BudgetProvider loads a budget summary on select', () async {
    final provider = BudgetProvider(BudgetService(_client(_budgetMock())))..bind('h');
    await provider.loadBudgets();
    expect(provider.budgets.length, 1);
    expect(provider.summary.length, 1);
    expect(provider.summary.first.actual, 100);
    expect(provider.summary.first.remaining, 100);
  });

  testWidgets('the budgets screen renders category progress bars', (tester) async {
    final store = InMemoryTokenStore();
    final loginMock = MockClient((req) async {
      if (req.url.path == '/api/v1/auth/login') {
        return http.Response(
          _env({
            'accessToken': _jwt({'householdId': 'h', 'roles': 'supervising_user'}),
            'user': {'id': 'u', 'email': 'a@b.c', 'displayName': 'Owner'},
          }),
          200,
        );
      }
      return http.Response('{}', 404);
    });
    final auth = AuthProvider(
      tokenStore: store,
      authService: AuthService(ApiClient(baseUrl: 'http://t', client: loginMock, tokenStore: store)),
    );
    await auth.login('a@b.c', 'pw');

    final modules = ModuleProvider()..setActive(const [AppModules.finance]);
    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider<AuthProvider>.value(value: auth),
          ChangeNotifierProvider<ModuleProvider>.value(value: modules),
          ChangeNotifierProvider<BudgetProvider>.value(
            value: BudgetProvider(BudgetService(_client(_budgetMock()))),
          ),
        ],
        child: const MaterialApp(home: BudgetsScreen()),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Food'), findsOneWidget);
    expect(find.byType(LinearProgressIndicator), findsOneWidget);
    expect(find.text('100.00 remaining'), findsOneWidget);
  });
}
