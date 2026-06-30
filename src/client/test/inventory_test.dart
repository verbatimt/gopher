import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gopher/core/api/api_client.dart';
import 'package:gopher/core/constants.dart';
import 'package:gopher/core/storage/in_memory_token_store.dart';
import 'package:gopher/providers/auth_provider.dart';
import 'package:gopher/providers/inventory_provider.dart';
import 'package:gopher/providers/module_provider.dart';
import 'package:gopher/screens/inventory/inventory_form_screen.dart';
import 'package:gopher/screens/inventory/inventory_list_screen.dart';
import 'package:gopher/services/auth_service.dart';
import 'package:gopher/services/inventory_service.dart';
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

Map<String, dynamic> _item(String id, String name, {num qty = 5, bool low = false}) => {
      'id': id,
      'name': name,
      'unit': 'ea',
      'quantity': '$qty',
      'autoAddToGrocery': true,
      'isActive': true,
      'isLowStock': low,
    };

void main() {
  group('InventoryProvider', () {
    test('load populates items', () async {
      final mock = MockClient((req) async {
        if (req.url.path == '/api/v1/households/h/inventory') {
          return http.Response(_env({'items': [_item('1', 'Coffee'), _item('2', 'Tea', low: true)]}), 200);
        }
        return http.Response('{}', 404);
      });
      final provider = InventoryProvider(InventoryService(_client(mock)));
      await provider.load('h');
      expect(provider.items.length, 2);
      expect(provider.items[1].isLowStock, isTrue);
    });

    test('adjust reconciles to the server resulting quantity', () async {
      final mock = MockClient((req) async {
        if (req.url.path == '/api/v1/households/h/inventory/1/adjust' && req.method == 'POST') {
          return http.Response(_env({'item': _item('1', 'Coffee', qty: 3), 'groceryAdded': false}), 201);
        }
        if (req.url.path == '/api/v1/households/h/inventory') {
          return http.Response(_env({'items': [_item('1', 'Coffee', qty: 5)]}), 200);
        }
        return http.Response('{}', 404);
      });
      final provider = InventoryProvider(InventoryService(_client(mock)));
      await provider.load('h');
      final added = await provider.adjust('1', -2, 'consume');
      expect(added, isFalse);
      expect(provider.items.first.quantity, 3);
    });
  });

  group('inventory screens', () {
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

    Widget wrap(Widget child, AuthProvider auth, MockClient mock) {
      final modules = ModuleProvider()..setActive(const [AppModules.inventory]);
      return MultiProvider(
        providers: [
          ChangeNotifierProvider<AuthProvider>.value(value: auth),
          ChangeNotifierProvider<ModuleProvider>.value(value: modules),
          ChangeNotifierProvider<InventoryProvider>.value(
            value: InventoryProvider(InventoryService(_client(mock))),
          ),
        ],
        child: MaterialApp(home: child),
      );
    }

    testWidgets('list renders items with a low-stock badge + author FAB for supervisor', (tester) async {
      final auth = await authWith('supervising_user');
      final mock = MockClient((req) async {
        if (req.url.path == '/api/v1/households/h/inventory') {
          return http.Response(_env({'items': [_item('1', 'Coffee', low: true)]}), 200);
        }
        return http.Response('{}', 404);
      });
      await tester.pumpWidget(wrap(const InventoryListScreen(), auth, mock));
      await tester.pumpAndSettle();
      expect(find.text('Coffee'), findsOneWidget);
      expect(find.text('Low'), findsOneWidget);
      expect(find.widgetWithText(FloatingActionButton, 'New item'), findsOneWidget);
    });

    testWidgets('a supervised user sees no author FAB', (tester) async {
      final auth = await authWith('supervised_user');
      final mock = MockClient((req) async => http.Response(_env({'items': const []}), 200));
      await tester.pumpWidget(wrap(const InventoryListScreen(), auth, mock));
      await tester.pumpAndSettle();
      expect(find.widgetWithText(FloatingActionButton, 'New item'), findsNothing);
    });

    testWidgets('item form renders fields', (tester) async {
      final auth = await authWith('supervising_user');
      final mock = MockClient((req) async => http.Response('{}', 404));
      await tester.pumpWidget(wrap(const InventoryFormScreen(), auth, mock));
      await tester.pumpAndSettle();
      expect(find.widgetWithText(TextFormField, 'Name'), findsOneWidget);
      expect(find.widgetWithText(TextFormField, 'Quantity'), findsOneWidget);
      expect(find.text('Auto-add to grocery when low'), findsOneWidget);
    });

    testWidgets('wide window opens the item in a side-by-side detail pane', (tester) async {
      final auth = await authWith('supervising_user');
      final mock = MockClient((req) async {
        final path = req.url.path;
        if (path == '/api/v1/households/h/inventory') {
          return http.Response(_env({'items': [_item('1', 'Coffee')]}), 200);
        }
        if (path == '/api/v1/households/h/inventory/1') {
          return http.Response(_env({'item': _item('1', 'Coffee')}), 200);
        }
        if (path == '/api/v1/households/h/inventory/1/adjustments') {
          return http.Response(_env({'adjustments': const []}), 200);
        }
        return http.Response('{}', 404);
      });
      await tester.pumpWidget(wrap(
        const MediaQuery(
          data: MediaQueryData(size: Size(1000, 800)),
          child: InventoryListScreen(),
        ),
        auth,
        mock,
      ));
      await tester.pumpAndSettle();
      // Before selection the detail pane shows the empty-state placeholder.
      expect(find.text('Nothing selected'), findsOneWidget);
      // Selecting an item fills the detail pane in place (no full-screen push).
      await tester.tap(find.text('Coffee'));
      await tester.pumpAndSettle();
      expect(find.text('History'), findsOneWidget);
      expect(find.text('No adjustments yet.'), findsOneWidget);
      // The list pane is still present, so the name shows in both list and pane header.
      expect(find.text('Coffee'), findsWidgets);
    });
  });
}
