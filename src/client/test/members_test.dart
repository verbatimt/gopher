import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gopher/core/api/api_client.dart';
import 'package:gopher/core/storage/in_memory_token_store.dart';
import 'package:gopher/providers/auth_provider.dart';
import 'package:gopher/providers/household_provider.dart';
import 'package:gopher/screens/settings/members_screen.dart';
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

String _errEnvelope(int statusCode, String message) => jsonEncode({
      'version': 'v1',
      'statusCode': statusCode,
      'success': false,
      'message': message,
      'result': null,
    });

const _userJson = {
  'id': 'u1',
  'email': 'a@x.test',
  'displayName': 'A',
  'timezone': 'UTC',
  'currency': 'USD',
};

const _householdJson = {
  'id': 'hh-1',
  'name': 'Home',
  'timezone': 'UTC',
  'locale': 'en-US',
  'activeModules': <String>[],
  'rewardCurrencyName': 'Points',
};

const _owner = {
  'id': 'm-owner',
  'displayName': 'Owner',
  'avatarUrl': null,
  'dateOfBirth': null,
  'isManaged': false,
  'isOwner': true,
  'hasLogin': true,
  'claimable': false,
  'role': 'supervising_user',
};

const _kid = {
  'id': 'm-kid',
  'displayName': 'Kiddo',
  'avatarUrl': null,
  'dateOfBirth': null,
  'isManaged': true,
  'isOwner': false,
  'hasLogin': false,
  'claimable': true,
  'role': 'supervised_user',
};

typedef _Harness = ({
  AuthProvider auth,
  HouseholdProvider household,
  List<Map<String, dynamic>> patches,
});

/// Wire up the providers MembersScreen depends on over a MockClient that serves login, the
/// household read, the member roster (owner + a managed child) and the member-role PATCH.
Future<_Harness> _setup({required String role, bool failPatch = false}) async {
  final patches = <Map<String, dynamic>>[];
  final token = _jwt({'sub': 'u1', 'householdId': 'hh-1', 'roles': role});
  final mock = MockClient((req) async {
    final path = req.url.path;
    if (path == '/api/v1/auth/login') {
      return http.Response(_envelope({'user': _userJson, 'accessToken': token}), 200);
    }
    if (path == '/api/v1/households/hh-1' && req.method == 'GET') {
      return http.Response(_envelope({'household': _householdJson}), 200);
    }
    if (path == '/api/v1/households/hh-1/members' && req.method == 'GET') {
      return http.Response(_envelope({'members': [_owner, _kid]}), 200);
    }
    if (path.startsWith('/api/v1/households/hh-1/invites')) {
      return http.Response(_envelope({'invites': <dynamic>[]}), 200);
    }
    if (path == '/api/v1/households/hh-1/members/m-kid' && req.method == 'PATCH') {
      final body = (jsonDecode(req.body) as Map).cast<String, dynamic>();
      patches.add(body);
      if (failPatch) {
        return http.Response(_errEnvelope(409, 'Cannot change role.'), 409);
      }
      return http.Response(_envelope({'member': {..._kid, 'role': body['role']}}), 200);
    }
    return http.Response('{}', 404);
  });
  final store = InMemoryTokenStore();
  final api = ApiClient(baseUrl: 'http://t', client: mock, tokenStore: store);
  final auth = AuthProvider(tokenStore: store, authService: AuthService(api));
  await auth.login('a@x.test', 'password123');
  final household = HouseholdProvider(HouseholdService(api));
  await household.load('hh-1');
  return (auth: auth, household: household, patches: patches);
}

Widget _host(_Harness h) => MultiProvider(
      providers: [
        ChangeNotifierProvider<AuthProvider>.value(value: h.auth),
        ChangeNotifierProvider<HouseholdProvider>.value(value: h.household),
      ],
      child: const MaterialApp(home: MembersScreen()),
    );

void main() {
  testWidgets('supervisor sees a manage menu on non-owner members only', (tester) async {
    final h = await _setup(role: 'supervising_user');
    await tester.pumpWidget(_host(h));
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('member-menu-m-kid')), findsOneWidget);
    expect(find.byKey(const ValueKey('member-menu-m-owner')), findsNothing);
  });

  testWidgets('non-supervisors see no manage menu and no Add button', (tester) async {
    final h = await _setup(role: 'unsupervised_user');
    await tester.pumpWidget(_host(h));
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('member-menu-m-kid')), findsNothing);
    expect(find.byType(FloatingActionButton), findsNothing);
  });

  testWidgets('changing a role shows current role, PATCHes {role}, and confirms', (tester) async {
    final h = await _setup(role: 'supervising_user');
    await tester.pumpWidget(_host(h));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const ValueKey('member-menu-m-kid')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('change-role')));
    await tester.pumpAndSettle();

    // The dialog surfaces the member's current role explicitly.
    expect(find.text('Current role: Supervised'), findsOneWidget);

    // Pick "Supervisor" from the dropdown and save.
    await tester.tap(find.byKey(const ValueKey('change-role-dropdown')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Supervisor').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();

    expect(h.patches, isNotEmpty);
    expect(h.patches.last['role'], 'supervising_user');
    expect(find.text('Kiddo is now Supervisor'), findsOneWidget);
  });

  testWidgets('a rejected role change surfaces the server error', (tester) async {
    final h = await _setup(role: 'supervising_user', failPatch: true);
    await tester.pumpWidget(_host(h));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const ValueKey('member-menu-m-kid')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('change-role')));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const ValueKey('change-role-dropdown')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Supervisor').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();

    expect(find.text('Cannot change role.'), findsOneWidget);
  });
}
