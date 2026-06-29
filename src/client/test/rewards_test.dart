import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gopher/core/api/api_client.dart';
import 'package:gopher/core/constants.dart';
import 'package:gopher/core/storage/in_memory_token_store.dart';
import 'package:gopher/providers/auth_provider.dart';
import 'package:gopher/providers/household_provider.dart';
import 'package:gopher/providers/module_provider.dart';
import 'package:gopher/providers/notification_provider.dart';
import 'package:gopher/providers/reward_provider.dart';
import 'package:gopher/screens/rewards/rewards_screen.dart';
import 'package:gopher/services/auth_service.dart';
import 'package:gopher/services/household_service.dart';
import 'package:gopher/services/notification_service.dart';
import 'package:gopher/services/reward_service.dart';
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

Map<String, dynamic> _bal(int b, {int earned = 0, int redeemed = 0}) =>
    {'memberId': 'm', 'balance': b, 'lifetimeEarned': earned, 'lifetimeRedeemed': redeemed};

Map<String, dynamic> _item(String id, String name, int cost, {int count = 0, int? cap}) =>
    {'id': id, 'name': name, 'pointCost': cost, 'redemptionCount': count, 'redemptionCap': cap};

Map<String, dynamic> _tx(String id, String type, int amount, String status) =>
    {'id': id, 'memberId': 'm', 'type': type, 'amount': amount, 'balanceAfter': 0, 'status': status};

void main() {
  group('RewardProvider', () {
    test('load populates balance, store, and history', () async {
      final mock = MockClient((req) async {
        final p = req.url.path;
        if (p == '/api/v1/households/h/rewards/me') return http.Response(_env({'rewards': _bal(120, earned: 200, redeemed: 80)}), 200);
        if (p == '/api/v1/households/h/rewards/me/transactions') return http.Response(_env({'transactions': [_tx('t1', 'earn', 10, 'approved')]}), 200);
        if (p == '/api/v1/households/h/reward-store') return http.Response(_env({'items': [_item('i1', 'Toy', 50)]}), 200);
        return http.Response('{}', 404);
      });
      final provider = RewardProvider(RewardService(_client(mock)));
      await provider.load('h');
      expect(provider.ownBalance.balance, 120);
      expect(provider.store.length, 1);
      expect(provider.transactions.length, 1);
    });

    test('redeem posts then reloads', () async {
      var redeemed = false;
      final mock = MockClient((req) async {
        final p = req.url.path;
        if (p.endsWith('/redeem') && req.method == 'POST') {
          redeemed = true;
          return http.Response(_env({'transaction': _tx('t2', 'redeem', -50, 'pending')}), 201);
        }
        if (p == '/api/v1/households/h/rewards/me') return http.Response(_env({'rewards': _bal(120)}), 200);
        if (p.endsWith('/transactions')) return http.Response(_env({'transactions': const []}), 200);
        if (p.endsWith('/reward-store')) return http.Response(_env({'items': const []}), 200);
        return http.Response('{}', 404);
      });
      final provider = RewardProvider(RewardService(_client(mock)));
      await provider.load('h');
      final ok = await provider.redeem('i1');
      expect(ok, isTrue);
      expect(redeemed, isTrue);
    });

    test('decide approve hits the API', () async {
      var decided = '';
      final mock = MockClient((req) async {
        final p = req.url.path;
        if (p.contains('/reward-transactions/') && req.method == 'PATCH') {
          decided = jsonDecode(req.body)['decision'] as String;
          return http.Response(_env({'transaction': _tx('t2', 'redeem', -50, 'approved')}), 200);
        }
        if (p == '/api/v1/households/h/rewards/me') return http.Response(_env({'rewards': _bal(70)}), 200);
        if (p.endsWith('/transactions')) return http.Response(_env({'transactions': const []}), 200);
        if (p.endsWith('/reward-store')) return http.Response(_env({'items': const []}), 200);
        return http.Response('{}', 404);
      });
      final provider = RewardProvider(RewardService(_client(mock)));
      await provider.load('h');
      await provider.decide('t2', 'approve');
      expect(decided, 'approve');
    });

    test('a reward.updated WS event reloads the balance', () async {
      var bal = 10;
      final mock = MockClient((req) async {
        final p = req.url.path;
        if (p == '/api/v1/households/h/rewards/me') return http.Response(_env({'rewards': _bal(bal)}), 200);
        if (p.endsWith('/transactions')) return http.Response(_env({'transactions': const []}), 200);
        if (p.endsWith('/reward-store')) return http.Response(_env({'items': const []}), 200);
        return http.Response('{}', 404);
      });
      final provider = RewardProvider(RewardService(_client(mock)));
      await provider.load('h');
      expect(provider.ownBalance.balance, 10);
      bal = 60;
      final controller = StreamController<Map<String, dynamic>>.broadcast();
      provider.bindEvents(controller.stream);
      controller.add({'type': 'reward.updated', 'payload': const {}});
      await Future<void>.delayed(const Duration(milliseconds: 20));
      expect(provider.ownBalance.balance, 60);
      await controller.close();
    });
  });

  group('RewardsScreen', () {
    Future<AuthProvider> supervisorAuth() async {
      final store = InMemoryTokenStore();
      final mock = MockClient((req) async {
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
        authService: AuthService(ApiClient(baseUrl: 'http://t', client: mock, tokenStore: store)),
      );
      await auth.login('a@b.c', 'pw');
      return auth;
    }

    Widget wrap(Widget child, AuthProvider auth, MockClient mock) {
      final modules = ModuleProvider()..setActive(const [AppModules.rewards]);
      return MultiProvider(
        providers: [
          ChangeNotifierProvider<AuthProvider>.value(value: auth),
          ChangeNotifierProvider<ModuleProvider>.value(value: modules),
          ChangeNotifierProvider<RewardProvider>.value(
            value: RewardProvider(RewardService(_client(mock))),
          ),
          ChangeNotifierProvider<HouseholdProvider>.value(
            value: HouseholdProvider(HouseholdService(_client(mock))),
          ),
          ChangeNotifierProvider<NotificationProvider>.value(
            value: NotificationProvider(NotificationService(_client(mock))),
          ),
        ],
        child: MaterialApp(home: child),
      );
    }

    MockClient storeMock(int balance, List<Map<String, dynamic>> items) => MockClient((req) async {
          final p = req.url.path;
          if (p == '/api/v1/households/h/rewards/me') return http.Response(_env({'rewards': _bal(balance)}), 200);
          if (p.endsWith('/transactions')) return http.Response(_env({'transactions': const []}), 200);
          if (p.endsWith('/reward-store')) return http.Response(_env({'items': items}), 200);
          return http.Response('{}', 404);
        });

    testWidgets('renders the balance', (tester) async {
      final auth = await supervisorAuth();
      await tester.pumpWidget(wrap(const RewardsScreen(), auth, storeMock(120, const [])));
      await tester.pumpAndSettle();
      expect(find.text('120 points'), findsOneWidget);
    });

    testWidgets('disables Redeem when the item is unaffordable', (tester) async {
      final auth = await supervisorAuth();
      await tester.pumpWidget(
        wrap(const RewardsScreen(), auth, storeMock(10, [_item('i1', 'Big prize', 100)])),
      );
      await tester.pumpAndSettle();
      final button = tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Redeem'));
      expect(button.onPressed, isNull);
    });

    testWidgets('a supervisor sees approve/reject on a pending redemption', (tester) async {
      final auth = await supervisorAuth();
      final mock = MockClient((req) async {
        final p = req.url.path;
        if (p == '/api/v1/households/h/rewards/me') return http.Response(_env({'rewards': _bal(200)}), 200);
        if (p.endsWith('/transactions')) return http.Response(_env({'transactions': [_tx('t9', 'redeem', -50, 'pending')]}), 200);
        if (p.endsWith('/reward-store')) return http.Response(_env({'items': const []}), 200);
        return http.Response('{}', 404);
      });
      await tester.pumpWidget(wrap(const RewardsScreen(), auth, mock));
      await tester.pumpAndSettle();
      expect(find.byTooltip('Approve'), findsOneWidget);
      expect(find.byTooltip('Reject'), findsOneWidget);
    });
  });
}
