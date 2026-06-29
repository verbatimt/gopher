import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:gopher/core/api/api_client.dart';
import 'package:gopher/core/storage/in_memory_token_store.dart';
import 'package:gopher/models/auth_state.dart';
import 'package:gopher/providers/auth_provider.dart';
import 'package:gopher/providers/health_provider.dart';
import 'package:gopher/providers/household_provider.dart';
import 'package:gopher/providers/module_provider.dart';
import 'package:gopher/services/auth_service.dart';
import 'package:gopher/services/health_service.dart';
import 'package:gopher/services/household_service.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

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

ApiClient _client(MockClient mock, InMemoryTokenStore store) =>
    ApiClient(baseUrl: 'http://t', client: mock, tokenStore: store);

void main() {
  group('AuthProvider', () {
    test('login authenticates, stores the token, and decodes household + roles', () async {
      final token = _jwt({'sub': 'u1', 'householdId': 'hh-1', 'roles': 'supervising_user'});
      final mock = MockClient((req) async {
        if (req.url.path == '/api/v1/auth/login') {
          return http.Response(_envelope({'user': _userJson, 'accessToken': token}), 200);
        }
        return http.Response('{}', 404);
      });
      final store = InMemoryTokenStore();
      final auth = AuthProvider(tokenStore: store, authService: AuthService(_client(mock, store)));

      expect(await auth.login('a@x.test', 'password123'), isTrue);
      expect(auth.isAuthenticated, isTrue);
      expect(auth.householdId, 'hh-1');
      expect(auth.isSupervisor, isTrue);
      expect(await store.readAccessToken(), token);
    });

    test('init with no stored token resolves to unauthenticated', () async {
      final mock = MockClient((req) async => http.Response('{}', 404));
      final store = InMemoryTokenStore();
      final auth = AuthProvider(tokenStore: store, authService: AuthService(_client(mock, store)));
      await auth.init();
      expect(auth.status, AuthStatus.unauthenticated);
    });

    test('init with a stored token validates via /me', () async {
      final token = _jwt({'sub': 'u1', 'householdId': 'hh-1', 'roles': 'unsupervised_user'});
      final mock = MockClient((req) async {
        if (req.url.path == '/api/v1/auth/me') {
          return http.Response(_envelope({'user': _userJson}), 200);
        }
        return http.Response('{}', 404);
      });
      final store = InMemoryTokenStore();
      await store.writeAccessToken(token);
      final auth = AuthProvider(tokenStore: store, authService: AuthService(_client(mock, store)));
      await auth.init();
      expect(auth.isAuthenticated, isTrue);
      expect(auth.isSupervisor, isFalse);
    });

    test('signOut clears the token and state', () async {
      final token = _jwt({'sub': 'u1', 'householdId': 'hh-1', 'roles': 'supervising_user'});
      final mock = MockClient((req) async {
        if (req.url.path == '/api/v1/auth/login') {
          return http.Response(_envelope({'user': _userJson, 'accessToken': token}), 200);
        }
        return http.Response(_envelope(null), 200); // logout
      });
      final store = InMemoryTokenStore();
      final auth = AuthProvider(tokenStore: store, authService: AuthService(_client(mock, store)));
      await auth.login('a@x.test', 'password123');
      await auth.signOut();
      expect(auth.isAuthenticated, isFalse);
      expect(await store.readAccessToken(), isNull);
    });
  });

  group('HouseholdProvider', () {
    test('load populates household, members, and pending invites', () async {
      final mock = MockClient((req) async {
        final path = req.url.path;
        if (path == '/api/v1/households/hh-1') {
          return http.Response(
            _envelope({
              'household': {
                'id': 'hh-1',
                'name': 'Home',
                'timezone': 'UTC',
                'locale': 'en-US',
                'activeModules': ['calendar', 'tasks'],
                'rewardCurrencyName': 'Points',
              },
            }),
            200,
          );
        }
        if (path == '/api/v1/households/hh-1/members') {
          return http.Response(
            _envelope({
              'members': [
                {'id': 'm1', 'displayName': 'A', 'isManaged': false, 'isOwner': true, 'hasLogin': true, 'role': 'supervising_user'},
              ],
            }),
            200,
          );
        }
        if (path == '/api/v1/households/hh-1/invites') {
          return http.Response(
            _envelope({
              'invites': [
                {'id': 'i1', 'email': 'b@x.test', 'status': 'pending'},
              ],
            }),
            200,
          );
        }
        return http.Response('{}', 404);
      });
      final store = InMemoryTokenStore();
      final provider = HouseholdProvider(HouseholdService(_client(mock, store)));
      await provider.load('hh-1');
      expect(provider.household?.name, 'Home');
      expect(provider.members.length, 1);
      expect(provider.members.first.state.name, 'linked');
      expect(provider.pendingInvites.length, 1);
    });
  });

  group('HealthProvider', () {
    test('populates status on success', () async {
      final mock = MockClient(
        (req) async => http.Response(
          jsonEncode({
            'status': 'healthy',
            'services': {'database': true, 'redis': true},
            'version': 'v1',
            'uptime': 1,
          }),
          200,
        ),
      );
      final store = InMemoryTokenStore();
      final provider = HealthProvider(HealthService(_client(mock, store)));
      await provider.refresh();
      expect(provider.status?.healthy, isTrue);
      expect(provider.hasError, isFalse);
    });
  });

  group('ModuleProvider', () {
    test('gates by active modules', () {
      final modules = ModuleProvider();
      expect(modules.isActive('finance'), isTrue);
      modules.setActive(['dashboard']);
      expect(modules.isActive('finance'), isFalse);
    });
  });
}
