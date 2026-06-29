import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gopher/core/api/api_client.dart';
import 'package:gopher/core/constants.dart';
import 'package:gopher/core/storage/in_memory_token_store.dart';
import 'package:gopher/providers/auth_provider.dart';
import 'package:gopher/providers/household_provider.dart';
import 'package:gopher/providers/medication_provider.dart';
import 'package:gopher/providers/module_provider.dart';
import 'package:gopher/providers/notification_provider.dart';
import 'package:gopher/screens/medications/medication_form_screen.dart';
import 'package:gopher/screens/medications/medication_list_screen.dart';
import 'package:gopher/services/auth_service.dart';
import 'package:gopher/services/household_service.dart';
import 'package:gopher/services/medication_service.dart';
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

/// Unsigned JWT (decode-only on the client) carrying household + roles claims.
String _jwt(Map<String, dynamic> claims) {
  String seg(Map<String, dynamic> m) =>
      base64Url.encode(utf8.encode(jsonEncode(m))).replaceAll('=', '');
  return '${seg({'alg': 'none'})}.${seg(claims)}.sig';
}

Map<String, dynamic> _sched(String id, String name, {String stock = '30', String threshold = '5'}) => {
      'id': id,
      'memberId': 'm',
      'medicationName': name,
      'dosageAmount': '1',
      'dosageUnit': 'mg',
      'rrule': 'FREQ=DAILY;BYHOUR=8;BYMINUTE=0;BYSECOND=0',
      'startDate': '2024-06-01',
      'stockQuantity': stock,
      'refillThreshold': threshold,
      'doseWindowMinutes': 120,
      'isActive': true,
    };

void main() {
  group('MedicationProvider', () {
    test('load populates schedules', () async {
      final mock = MockClient((req) async {
        if (req.url.path == '/api/v1/households/h/medications') {
          return http.Response(_env({'schedules': [_sched('1', 'Vitamin D'), _sched('2', 'Iron')]}), 200);
        }
        return http.Response('{}', 404);
      });
      final provider = MedicationProvider(MedicationService(_client(mock)));
      await provider.load('h');
      expect(provider.schedules.length, 2);
      expect(provider.schedules.first.medicationName, 'Vitamin D');
    });

    test('logDose posts and returns the dose', () async {
      final mock = MockClient((req) async {
        if (req.url.path == '/api/v1/households/h/medications/1/doses' && req.method == 'POST') {
          return http.Response(
            _env({'dose': {'id': 'd1', 'scheduleId': '1', 'scheduledAt': '2024-06-10T08:00:00.000Z', 'status': 'taken'}}),
            201,
          );
        }
        if (req.url.path == '/api/v1/households/h/medications') {
          return http.Response(_env({'schedules': [_sched('1', 'Vitamin D')]}), 200);
        }
        return http.Response('{}', 404);
      });
      final provider = MedicationProvider(MedicationService(_client(mock)));
      await provider.load('h');
      final dose = await provider.logDose('1', {'status': 'taken'});
      expect(dose, isNotNull);
      expect(dose!.status, 'taken');
    });

    test('logRefill posts and refreshes stock', () async {
      final mock = MockClient((req) async {
        if (req.url.path == '/api/v1/households/h/medications/1/refills' && req.method == 'POST') {
          return http.Response(_env({'schedule': _sched('1', 'Iron', stock: '90')}), 201);
        }
        if (req.url.path == '/api/v1/households/h/medications') {
          return http.Response(_env({'schedules': [_sched('1', 'Iron', stock: '90')]}), 200);
        }
        return http.Response('{}', 404);
      });
      final provider = MedicationProvider(MedicationService(_client(mock)));
      await provider.load('h');
      final ok = await provider.logRefill('1', {'quantityAdded': 60});
      expect(ok, isTrue);
      expect(provider.schedules.first.stock, 90);
    });

    test('a medication.reminder WS event surfaces lastReminder', () async {
      final mock = MockClient((req) async {
        if (req.url.path == '/api/v1/households/h/medications') {
          return http.Response(_env({'schedules': const []}), 200);
        }
        return http.Response('{}', 404);
      });
      final provider = MedicationProvider(MedicationService(_client(mock)));
      await provider.load('h');
      final controller = StreamController<Map<String, dynamic>>.broadcast();
      provider.bindEvents(controller.stream);
      controller.add({'type': 'medication.reminder', 'payload': {'medicationName': 'Iron'}});
      await Future<void>.delayed(Duration.zero);
      expect(provider.lastReminder, 'Time for Iron');
      await controller.close();
    });
  });

  group('medication screens', () {
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
      final modules = ModuleProvider()..setActive(const [AppModules.medications]);
      return MultiProvider(
        providers: [
          ChangeNotifierProvider<AuthProvider>.value(value: auth),
          ChangeNotifierProvider<ModuleProvider>.value(value: modules),
          ChangeNotifierProvider<MedicationProvider>.value(
            value: MedicationProvider(MedicationService(_client(mock))),
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

    testWidgets('list renders schedules and shows the supervisor FAB', (tester) async {
      final auth = await supervisorAuth();
      final mock = MockClient((req) async {
        if (req.url.path == '/api/v1/households/h/medications') {
          return http.Response(_env({'schedules': [_sched('1', 'Vitamin D')]}), 200);
        }
        return http.Response('{}', 404);
      });
      await tester.pumpWidget(wrap(const MedicationListScreen(), auth, mock));
      await tester.pumpAndSettle();
      expect(find.text('Vitamin D'), findsOneWidget);
      expect(find.widgetWithText(FloatingActionButton, 'New schedule'), findsOneWidget);
    });

    testWidgets('a non-supervisor sees no create FAB', (tester) async {
      final store = InMemoryTokenStore();
      final mock = MockClient((req) async => http.Response(_env({'schedules': const []}), 200));
      final auth = AuthProvider(
        tokenStore: store,
        authService: AuthService(ApiClient(baseUrl: 'http://t', client: mock, tokenStore: store)),
      );
      await tester.pumpWidget(wrap(const MedicationListScreen(), auth, mock));
      await tester.pumpAndSettle();
      expect(find.widgetWithText(FloatingActionButton, 'New schedule'), findsNothing);
    });

    testWidgets('the schedule form is restricted for non-supervisors', (tester) async {
      final store = InMemoryTokenStore();
      final mock = MockClient((req) async => http.Response('{}', 404));
      final auth = AuthProvider(
        tokenStore: store,
        authService: AuthService(ApiClient(baseUrl: 'http://t', client: mock, tokenStore: store)),
      );
      await tester.pumpWidget(wrap(const MedicationFormScreen(), auth, mock));
      await tester.pumpAndSettle();
      expect(find.textContaining('Only supervisors'), findsOneWidget);
    });
  });
}
