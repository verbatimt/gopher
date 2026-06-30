import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gopher/core/api/api_client.dart';
import 'package:gopher/core/constants.dart';
import 'package:gopher/core/storage/in_memory_token_store.dart';
import 'package:gopher/providers/auth_provider.dart';
import 'package:gopher/providers/meal_provider.dart';
import 'package:gopher/providers/module_provider.dart';
import 'package:gopher/providers/notification_provider.dart';
import 'package:gopher/providers/recipe_provider.dart';
import 'package:gopher/screens/meals/meal_planner_screen.dart';
import 'package:gopher/services/auth_service.dart';
import 'package:gopher/services/meal_service.dart';
import 'package:gopher/services/notification_service.dart';
import 'package:gopher/services/recipe_service.dart';
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
  test('weekStartOf returns the containing Sunday', () {
    // 2024-06-19 is a Wednesday → week starts Sunday 2024-06-16.
    expect(MealProvider.weekStartOf(DateTime(2024, 6, 19)), '2024-06-16');
    // A Sunday maps to itself.
    expect(MealProvider.weekStartOf(DateTime(2024, 6, 16)), '2024-06-16');
  });

  group('MealProvider', () {
    test('setEntry creates a plan lazily then adds the entry', () async {
      var planCreated = false;
      var entryPosted = false;
      final mock = MockClient((req) async {
        final p = req.url.path;
        if (p == '/api/v1/households/h/meal-plans' && req.method == 'GET') {
          return http.Response(_env({'plans': const []}), 200);
        }
        if (p == '/api/v1/households/h/meal-plans' && req.method == 'POST') {
          planCreated = true;
          return http.Response(_env({'plan': {'id': 'p1', 'weekStartDate': '2024-06-16'}}), 201);
        }
        if (p == '/api/v1/households/h/meal-plans/p1/entries' && req.method == 'POST') {
          entryPosted = true;
          return http.Response(_env({'entry': {'id': 'e1'}}), 201);
        }
        if (p == '/api/v1/households/h/meal-plans/p1') {
          return http.Response(
            _env({
              'plan': {'id': 'p1', 'weekStartDate': '2024-06-16'},
              'entries': [
                {'id': 'e1', 'dayOfWeek': 2, 'mealType': 'dinner', 'mealName': 'Tacos'},
              ],
            }),
            200,
          );
        }
        return http.Response('{}', 404);
      });
      final provider = MealProvider(MealService(_client(mock)));
      await provider.loadWeek('h', '2024-06-16');
      expect(provider.plan, isNull);
      final ok = await provider.setEntry(2, 'dinner', 'Tacos');
      expect(ok, isTrue);
      expect(planCreated, isTrue);
      expect(entryPosted, isTrue);
      expect(provider.plan?.entryFor(2, 'dinner')?.mealName, 'Tacos');
    });

    test('grocery add + toggle reflects checked state', () async {
      var checked = false;
      final mock = MockClient((req) async {
        final p = req.url.path;
        if (p == '/api/v1/households/h/grocery') {
          return http.Response(
            _env({
              'items': [
                {'id': 'g1', 'name': 'Milk', 'isChecked': checked},
              ],
            }),
            200,
          );
        }
        if (p == '/api/v1/households/h/grocery/items/g1' && req.method == 'PATCH') {
          checked = true;
          return http.Response(_env({'item': {'id': 'g1', 'name': 'Milk', 'isChecked': true}}), 200);
        }
        return http.Response('{}', 404);
      });
      final provider = MealProvider(MealService(_client(mock)));
      await provider.loadWeek('h', '2024-06-16'); // sets household id
      await provider.loadGrocery();
      expect(provider.grocery.first.isChecked, isFalse);
      await provider.toggleGroceryItem(provider.grocery.first);
      expect(provider.grocery.first.isChecked, isTrue);
    });
  });

  testWidgets('the meal planner renders a 7-day grid', (tester) async {
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

    final mealMock = MockClient((req) async {
      if (req.url.path == '/api/v1/households/h/meal-plans') {
        return http.Response(_env({'plans': const []}), 200);
      }
      return http.Response('{}', 404);
    });
    final modules = ModuleProvider()..setActive(const [AppModules.meals]);
    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider<AuthProvider>.value(value: auth),
          ChangeNotifierProvider<ModuleProvider>.value(value: modules),
          ChangeNotifierProvider<MealProvider>.value(
            value: MealProvider(MealService(_client(mealMock))),
          ),
          ChangeNotifierProvider<RecipeProvider>.value(
            value: RecipeProvider(RecipeService(_client(mealMock))),
          ),
          ChangeNotifierProvider<NotificationProvider>.value(
            value: NotificationProvider(NotificationService(_client(mealMock))),
          ),
        ],
        child: const MaterialApp(home: MealPlannerScreen()),
      ),
    );
    await tester.pumpAndSettle();
    // The first day card + its meal slots are visible (later days are lazily built).
    expect(find.text('Sun'), findsOneWidget);
    expect(find.text('Breakfast'), findsWidgets);
    expect(find.textContaining('Week of'), findsOneWidget);
  });
}
