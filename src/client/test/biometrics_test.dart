import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gopher/core/api/api_client.dart';
import 'package:gopher/core/constants.dart';
import 'package:gopher/core/storage/in_memory_token_store.dart';
import 'package:gopher/providers/auth_provider.dart';
import 'package:gopher/providers/biometric_provider.dart';
import 'package:gopher/providers/household_provider.dart';
import 'package:gopher/providers/module_provider.dart';
import 'package:gopher/screens/health/health_overview_screen.dart';
import 'package:gopher/screens/health/measurement_form_screen.dart';
import 'package:gopher/services/auth_service.dart';
import 'package:gopher/services/biometric_service.dart';
import 'package:gopher/services/household_service.dart';
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

Map<String, dynamic> _type(String key, String name, {String shape = 'single', String unit = 'kg'}) => {
      'id': 't_$key',
      'householdId': null,
      'key': key,
      'displayName': name,
      'valueShape': shape,
      'unitDefault': unit,
      'precision': shape == 'dual' ? 0 : 1,
      'minNormal': null,
      'maxNormal': null,
      'isSystemDefault': true,
    };

Map<String, dynamic> _meas(String id, String typeKey, num value, {num? secondary, String unit = 'kg'}) => {
      'id': id,
      'memberId': 'me',
      'typeId': 't_$typeKey',
      'typeKey': typeKey,
      'valueNumeric': '$value',
      'valueSecondary': secondary?.toString(),
      'unit': unit,
      'measuredAt': '2024-06-01T08:00:00.000Z',
      'recordedBy': 'me',
      'isActive': true,
    };

void main() {
  group('BiometricProvider', () {
    test('loadTypes populates the catalog', () async {
      final mock = MockClient((req) async {
        if (req.url.path == '/api/v1/households/h/measurement-types') {
          return http.Response(_env({'types': [_type('weight', 'Weight'), _type('blood_pressure', 'Blood Pressure', shape: 'dual', unit: 'mmHg')]}), 200);
        }
        return http.Response('{}', 404);
      });
      final provider = BiometricProvider(BiometricService(_client(mock)));
      await provider.loadTypes('h');
      expect(provider.types.length, 2);
      expect(provider.typeByKey('blood_pressure')!.isDual, isTrue);
    });

    test('record prepends optimistically; latestByType reflects it', () async {
      final mock = MockClient((req) async {
        if (req.url.path == '/api/v1/households/h/members/me/measurements' && req.method == 'POST') {
          return http.Response(_env({'measurement': _meas('m2', 'weight', 81)}), 201);
        }
        if (req.url.path == '/api/v1/households/h/members/me/measurements') {
          return http.Response(_env({'measurements': [_meas('m1', 'weight', 80)]}), 200);
        }
        if (req.url.path == '/api/v1/households/h/members/me/measurement-targets') {
          return http.Response(_env({'targets': const []}), 200);
        }
        return http.Response('{}', 404);
      });
      final provider = BiometricProvider(BiometricService(_client(mock)));
      await provider.loadMember('h', 'me');
      expect(provider.measurements.length, 1);
      final ok = await provider.record('me', {'typeKey': 'weight', 'valueNumeric': 81});
      expect(ok, isTrue);
      expect(provider.measurements.first.id, 'm2');
      expect(provider.latestByType['weight']!.value, 81);
    });

    test('trends parses summary and series', () async {
      final mock = MockClient((req) async {
        if (req.url.path == '/api/v1/households/h/members/me/measurements/trends') {
          return http.Response(
            _env({
              'trends': {
                'typeKey': 'weight',
                'count': 2,
                'latest': {'measuredAt': '2024-06-02T08:00:00.000Z', 'value': 79, 'valueSecondary': null},
                'min': 79,
                'max': 80,
                'avg': 79.5,
                'adherencePct': 50.0,
                'series': [
                  {'measuredAt': '2024-06-01T08:00:00.000Z', 'value': 80, 'valueSecondary': null},
                  {'measuredAt': '2024-06-02T08:00:00.000Z', 'value': 79, 'valueSecondary': null},
                ],
              }
            }),
            200,
          );
        }
        return http.Response('{}', 404);
      });
      final provider = BiometricProvider(BiometricService(_client(mock)));
      provider.loadMember('h', 'me'); // sets householdId
      await Future<void>.delayed(Duration.zero);
      final trend = await provider.trends('me', typeKey: 'weight');
      expect(trend, isNotNull);
      expect(trend!.count, 2);
      expect(trend.avg, 79.5);
      expect(trend.series.length, 2);
    });
  });

  group('vitals screens', () {
    Future<AuthProvider> authWith(String role, {String? memberId}) async {
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
        if (req.url.path == '/api/v1/auth/me') {
          return http.Response(
            _env({'user': {'id': 'u', 'email': 'a@b.c', 'displayName': 'Owner', 'memberId': memberId}}),
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
      final modules = ModuleProvider()..setActive(const [AppModules.health]);
      return MultiProvider(
        providers: [
          ChangeNotifierProvider<AuthProvider>.value(value: auth),
          ChangeNotifierProvider<ModuleProvider>.value(value: modules),
          ChangeNotifierProvider<BiometricProvider>.value(
            value: BiometricProvider(BiometricService(_client(mock))),
          ),
          ChangeNotifierProvider<HouseholdProvider>.value(
            value: HouseholdProvider(HouseholdService(_client(mock))),
          ),
        ],
        child: MaterialApp(home: child),
      );
    }

    testWidgets('overview renders type cards with the latest reading', (tester) async {
      final auth = await authWith('supervising_user', memberId: 'me');
      final mock = MockClient((req) async {
        if (req.url.path == '/api/v1/households/h/measurement-types') {
          return http.Response(_env({'types': [_type('weight', 'Weight')]}), 200);
        }
        if (req.url.path == '/api/v1/households/h/members/me/measurements') {
          return http.Response(_env({'measurements': [_meas('m1', 'weight', 80)]}), 200);
        }
        if (req.url.path == '/api/v1/households/h/members/me/measurement-targets') {
          return http.Response(_env({'targets': const []}), 200);
        }
        if (req.url.path == '/api/v1/auth/me') {
          return http.Response(_env({'user': {'id': 'u', 'email': 'a@b.c', 'displayName': 'Owner', 'memberId': 'me'}}), 200);
        }
        return http.Response('{}', 404);
      });
      await tester.pumpWidget(wrap(const HealthOverviewScreen(), auth, mock));
      await tester.pumpAndSettle();
      expect(find.text('Weight'), findsOneWidget);
      expect(find.textContaining('80.0 kg'), findsOneWidget);
    });

    testWidgets('form shows two fields for a dual type and one for single', (tester) async {
      final auth = await authWith('supervising_user', memberId: 'me');
      final mock = MockClient((req) async {
        if (req.url.path == '/api/v1/households/h/measurement-types') {
          return http.Response(
            _env({'types': [_type('blood_pressure', 'Blood Pressure', shape: 'dual', unit: 'mmHg'), _type('weight', 'Weight')]}),
            200,
          );
        }
        return http.Response('{}', 404);
      });
      await tester.pumpWidget(wrap(const MeasurementFormScreen(memberId: 'me'), auth, mock));
      await tester.pumpAndSettle();
      // blood_pressure is first → dual fields present.
      expect(find.text('Systolic'), findsOneWidget);
      expect(find.text('Diastolic'), findsOneWidget);
    });

    testWidgets('dual reading missing the second value is blocked', (tester) async {
      final auth = await authWith('supervising_user', memberId: 'me');
      var posted = false;
      final mock = MockClient((req) async {
        if (req.url.path == '/api/v1/households/h/measurement-types') {
          return http.Response(
            _env({'types': [_type('blood_pressure', 'Blood Pressure', shape: 'dual', unit: 'mmHg')]}),
            200,
          );
        }
        if (req.method == 'POST') {
          posted = true;
          return http.Response(_env({'measurement': _meas('x', 'blood_pressure', 120, secondary: 80, unit: 'mmHg')}), 201);
        }
        return http.Response('{}', 404);
      });
      await tester.pumpWidget(wrap(const MeasurementFormScreen(memberId: 'me'), auth, mock));
      await tester.pumpAndSettle();
      await tester.enterText(find.widgetWithText(TextFormField, 'Systolic'), '120');
      await tester.tap(find.widgetWithText(FilledButton, 'Record'));
      await tester.pump(); // surface the snackbar
      expect(find.textContaining('needs both values'), findsOneWidget);
      expect(posted, isFalse);
    });

    testWidgets('wide window opens a measurement trend in a side-by-side pane', (tester) async {
      final auth = await authWith('supervising_user', memberId: 'me');
      final mock = MockClient((req) async {
        final path = req.url.path;
        if (path == '/api/v1/households/h/measurement-types') {
          return http.Response(_env({'types': [_type('weight', 'Weight')]}), 200);
        }
        if (path == '/api/v1/households/h/members/me/measurements/trends') {
          return http.Response(
            _env({
              'trends': {
                'typeKey': 'weight',
                'count': 2,
                'latest': {'measuredAt': '2024-06-02T08:00:00.000Z', 'value': 79, 'valueSecondary': null},
                'min': 79,
                'max': 80,
                'avg': 79.5,
                'adherencePct': 50.0,
                'series': [
                  {'measuredAt': '2024-06-01T08:00:00.000Z', 'value': 80, 'valueSecondary': null},
                  {'measuredAt': '2024-06-02T08:00:00.000Z', 'value': 79, 'valueSecondary': null},
                ],
              },
            }),
            200,
          );
        }
        if (path == '/api/v1/households/h/members/me/measurements') {
          return http.Response(_env({'measurements': [_meas('m1', 'weight', 80)]}), 200);
        }
        if (path == '/api/v1/households/h/members/me/measurement-targets') {
          return http.Response(_env({'targets': const []}), 200);
        }
        if (path == '/api/v1/auth/me') {
          return http.Response(_env({'user': {'id': 'u', 'email': 'a@b.c', 'displayName': 'Owner', 'memberId': 'me'}}), 200);
        }
        return http.Response('{}', 404);
      });
      await tester.pumpWidget(wrap(
        const MediaQuery(
          data: MediaQueryData(size: Size(1100, 800)),
          child: HealthOverviewScreen(),
        ),
        auth,
        mock,
      ));
      await tester.pumpAndSettle();
      // Before selection the detail pane shows the empty-state placeholder.
      expect(find.text('Nothing selected'), findsOneWidget);
      // Selecting a measurement type fills the trend pane in place (no full-screen push).
      await tester.tap(find.text('Weight'));
      await tester.pumpAndSettle();
      expect(find.text('7d'), findsOneWidget); // range selector
      expect(find.text('Average'), findsOneWidget); // summary row
      // The list pane is still present, so the name shows in both card and pane header.
      expect(find.text('Weight'), findsWidgets);
    });
  });
}
