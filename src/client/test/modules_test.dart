import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gopher/core/api/api_client.dart';
import 'package:gopher/core/storage/in_memory_token_store.dart';
import 'package:gopher/providers/auth_provider.dart';
import 'package:gopher/providers/household_provider.dart';
import 'package:gopher/providers/module_provider.dart';
import 'package:gopher/screens/settings/modules_screen.dart';
import 'package:gopher/services/auth_service.dart';
import 'package:gopher/services/household_service.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';

String _jwt(Map<String, dynamic> payload) =>
    'h.${base64Url.encode(utf8.encode(jsonEncode(payload)))}.s';

String _envelope(Object? result) => jsonEncode({
      'version': 'v1',
      'statusCode': 200,
      'success': true,
      'message': 'OK',
      'result': result,
    });

const _userJson = {
  'id': 'u1',
  'email': 'a@x.test',
  'displayName': 'A',
  'timezone': 'UTC',
  'currency': 'USD',
};

Map<String, dynamic> _householdJson(List<String> activeModules) => {
      'id': 'hh-1',
      'name': 'Home',
      'timezone': 'UTC',
      'locale': 'en-US',
      'activeModules': activeModules,
      'rewardCurrencyName': 'Points',
    };

typedef _Harness = ({
  AuthProvider auth,
  HouseholdProvider household,
  ModuleProvider modules,
  List<String> patches,
});

/// Wire up the providers ModulesScreen depends on, over a MockClient that serves login, the
/// household read, and the settings PATCH (echoing back the activeModules it was sent).
Future<_Harness> _setup({
  required String role,
  List<String> active = const ['calendar', 'tasks'],
}) async {
  final patchedModules = <String>[];
  final token = _jwt({'sub': 'u1', 'householdId': 'hh-1', 'roles': role});
  final mock = MockClient((req) async {
    final path = req.url.path;
    if (path == '/api/v1/auth/login') {
      return http.Response(_envelope({'user': _userJson, 'accessToken': token}), 200);
    }
    if (path == '/api/v1/households/hh-1' && req.method == 'GET') {
      return http.Response(_envelope({'household': _householdJson(active)}), 200);
    }
    if (path == '/api/v1/households/hh-1' && req.method == 'PATCH') {
      final body = jsonDecode(req.body) as Map<String, dynamic>;
      final mods = (body['activeModules'] as List).cast<String>();
      patchedModules
        ..clear()
        ..addAll(mods);
      return http.Response(_envelope({'household': _householdJson(mods)}), 200);
    }
    if (path == '/api/v1/households/hh-1/members') {
      return http.Response(_envelope({'members': <dynamic>[]}), 200);
    }
    if (path == '/api/v1/households/hh-1/invites') {
      return http.Response(_envelope({'invites': <dynamic>[]}), 200);
    }
    return http.Response('{}', 404);
  });
  final store = InMemoryTokenStore();
  final api = ApiClient(baseUrl: 'http://t', client: mock, tokenStore: store);
  final auth = AuthProvider(tokenStore: store, authService: AuthService(api));
  await auth.login('a@x.test', 'password123');
  final household = HouseholdProvider(HouseholdService(api));
  await household.load('hh-1');
  final modules = ModuleProvider()..setActive([...active, 'dashboard']);
  return (auth: auth, household: household, modules: modules, patches: patchedModules);
}

Widget _host(_Harness h) => MultiProvider(
      providers: [
        ChangeNotifierProvider<AuthProvider>.value(value: h.auth),
        ChangeNotifierProvider<HouseholdProvider>.value(value: h.household),
        ChangeNotifierProvider<ModuleProvider>.value(value: h.modules),
      ],
      child: const MaterialApp(home: ModulesScreen()),
    );

void main() {
  testWidgets('renders a switch per feature module reflecting active_modules', (tester) async {
    final h = await _setup(role: 'supervising_user', active: ['calendar', 'tasks']);
    await tester.pumpWidget(_host(h));

    // Dashboard is always-on and is intentionally not shown as a switch.
    expect(find.byKey(const ValueKey('module-dashboard')), findsNothing);
    // Health is off (absent from active_modules); calendar is on.
    expect(
      tester.widget<SwitchListTile>(find.byKey(const ValueKey('module-health'))).value,
      isFalse,
    );
    expect(
      tester.widget<SwitchListTile>(find.byKey(const ValueKey('module-calendar'))).value,
      isTrue,
    );
  });

  testWidgets('enabling a module persists via PATCH and refreshes ModuleProvider', (tester) async {
    final h = await _setup(role: 'supervising_user', active: ['calendar', 'tasks']);
    await tester.pumpWidget(_host(h));

    expect(h.modules.isActive('health'), isFalse);

    await tester.tap(find.byKey(const ValueKey('module-health')));
    await tester.pumpAndSettle();

    // Persisted to the server (activeModules now includes health, dashboard excluded).
    expect(h.patches, contains('health'));
    expect(h.patches, isNot(contains('dashboard')));
    // ModuleProvider refreshed so ModuleGuards update without a reload.
    expect(h.modules.isActive('health'), isTrue);
    // The switch reflects the new persisted state.
    expect(
      tester.widget<SwitchListTile>(find.byKey(const ValueKey('module-health'))).value,
      isTrue,
    );
  });

  testWidgets('non-supervisors see an access-required message and no switches', (tester) async {
    final h = await _setup(role: 'unsupervised_user', active: ['calendar', 'tasks']);
    await tester.pumpWidget(_host(h));

    expect(find.text('Supervisor access required'), findsOneWidget);
    expect(find.byType(SwitchListTile), findsNothing);
  });
}
