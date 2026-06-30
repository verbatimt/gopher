import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gopher/core/api/api_client.dart';
import 'package:gopher/core/constants.dart';
import 'package:gopher/core/storage/in_memory_token_store.dart';
import 'package:gopher/providers/auth_provider.dart';
import 'package:gopher/providers/calendar_provider.dart';
import 'package:gopher/providers/module_provider.dart';
import 'package:gopher/providers/notification_provider.dart';
import 'package:gopher/providers/task_provider.dart';
import 'package:gopher/screens/calendar/calendar_screen.dart';
import 'package:gopher/screens/tasks/task_form_screen.dart';
import 'package:gopher/screens/tasks/task_list_screen.dart';
import 'package:gopher/services/auth_service.dart';
import 'package:gopher/services/calendar_service.dart';
import 'package:gopher/services/notification_service.dart';
import 'package:gopher/services/task_service.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:table_calendar/table_calendar.dart';

String _env(Object? result) => jsonEncode({
      'version': 'v1',
      'statusCode': 200,
      'success': true,
      'message': 'OK',
      'result': result,
    });

ApiClient _client(MockClient mock) =>
    ApiClient(baseUrl: 'http://t', client: mock, tokenStore: InMemoryTokenStore());

Map<String, dynamic> _task(String id, String status, {List<Map<String, dynamic>> steps = const []}) => {
      'id': id,
      'title': 'T-$id',
      'status': status,
      'unskippable': false,
      'steps': steps,
    };

void main() {
  group('TaskProvider', () {
    test('completeTask reflects the completed status', () async {
      final mock = MockClient((req) async {
        if (req.url.path == '/api/v1/households/h/tasks') {
          return http.Response(_env({'tasks': [_task('1', 'pending')]}), 200);
        }
        if (req.url.path == '/api/v1/households/h/tasks/1/complete') {
          return http.Response(_env({'task': _task('1', 'completed')}), 200);
        }
        return http.Response('{}', 404);
      });
      final provider = TaskProvider(TaskService(_client(mock)));
      await provider.load('h');
      expect(provider.tasks.first.isCompleted, isFalse);
      await provider.completeTask('1');
      expect(provider.tasks.first.isCompleted, isTrue);
    });

    test('toggleStep reflects auto-completion when all steps done', () async {
      final mock = MockClient((req) async {
        if (req.url.path.endsWith('/steps/s1')) {
          // Server auto-completed the parent because all steps are done.
          return http.Response(
            _env({'task': _task('1', 'completed', steps: [
              {'id': 's1', 'stepOrder': 1, 'description': 'A', 'isCompleted': true, 'passive': false},
            ])}),
            200,
          );
        }
        if (req.url.path == '/api/v1/households/h/tasks') {
          return http.Response(_env({'tasks': [_task('1', 'pending')]}), 200);
        }
        return http.Response('{}', 404);
      });
      final provider = TaskProvider(TaskService(_client(mock)));
      await provider.load('h');
      final updated = await provider.toggleStep('1', 's1', true);
      expect(updated?.isCompleted, isTrue);
    });
  });

  group('CalendarProvider', () {
    test('groups occurrences by day', () async {
      final mock = MockClient((req) async {
        if (req.url.path == '/api/v1/households/h/calendar') {
          return http.Response(
            _env({
              'occurrences': [
                {'itemId': 'a', 'type': 'event', 'title': 'A', 'date': '2024-07-01', 'status': 'pending', 'allDay': true},
                {'itemId': 'b', 'type': 'task', 'title': 'B', 'date': '2024-07-01', 'status': 'pending', 'allDay': true},
                {'itemId': 'c', 'type': 'event', 'title': 'C', 'date': '2024-07-05', 'status': 'pending', 'allDay': true},
              ],
            }),
            200,
          );
        }
        return http.Response('{}', 404);
      });
      final provider = CalendarProvider(CalendarService(_client(mock)));
      await provider.loadRange('h', DateTime(2024, 7), DateTime(2024, 7, 31));
      expect(provider.forDay(DateTime(2024, 7, 1)).length, 2);
      expect(provider.forDay(DateTime(2024, 7, 5)).length, 1);
      expect(provider.forDay(DateTime(2024, 7, 9)).length, 0);
    });
  });

  testWidgets('the task form blocks an exact schedule without a time', (tester) async {
    final mock = MockClient((req) async => http.Response('{}', 404));
    final provider = TaskProvider(TaskService(_client(mock)));
    await tester.pumpWidget(
      MaterialApp(
        home: ChangeNotifierProvider<TaskProvider>.value(value: provider, child: const TaskFormScreen()),
      ),
    );
    await tester.enterText(find.byType(TextFormField).first, 'My task');
    await tester.tap(find.text('Exact'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Create'));
    await tester.pump();
    expect(find.textContaining('Pick both a date and a time'), findsOneWidget);
  });

  testWidgets('the calendar screen renders a month calendar', (tester) async {
    final mock = MockClient((req) async => http.Response(_env({'occurrences': []}), 200));
    final auth = AuthProvider(
      tokenStore: InMemoryTokenStore(),
      authService: AuthService(_client(mock)),
    );
    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider<AuthProvider>.value(value: auth),
          ChangeNotifierProvider<CalendarProvider>.value(value: CalendarProvider(CalendarService(_client(mock)))),
          ChangeNotifierProvider<ModuleProvider>.value(value: ModuleProvider()),
          ChangeNotifierProvider<NotificationProvider>.value(value: NotificationProvider(NotificationService(_client(mock)))),
        ],
        child: const MaterialApp(home: CalendarScreen()),
      ),
    );
    await tester.pump();
    expect(find.byWidgetPredicate((w) => w is TableCalendar), findsOneWidget);
  });

  testWidgets('wide window opens the task in a side-by-side detail pane', (tester) async {
    String jwt(Map<String, dynamic> claims) {
      String seg(Map<String, dynamic> m) =>
          base64Url.encode(utf8.encode(jsonEncode(m))).replaceAll('=', '');
      return '${seg({'alg': 'none'})}.${seg(claims)}.sig';
    }

    final store = InMemoryTokenStore();
    final loginMock = MockClient((req) async {
      if (req.url.path == '/api/v1/auth/login') {
        return http.Response(
          _env({
            'accessToken': jwt({'householdId': 'h', 'roles': 'supervising_user'}),
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

    final mock = MockClient((req) async {
      final path = req.url.path;
      if (path == '/api/v1/households/h/tasks') {
        return http.Response(_env({'tasks': [_task('1', 'pending')]}), 200);
      }
      if (path == '/api/v1/households/h/tasks/1') {
        return http.Response(
          _env({
            'task': _task('1', 'pending', steps: [
              {'id': 's1', 'stepOrder': 1, 'description': 'Chop', 'isCompleted': false, 'passive': false},
            ]),
          }),
          200,
        );
      }
      return http.Response('{}', 404);
    });

    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider<AuthProvider>.value(value: auth),
          ChangeNotifierProvider<ModuleProvider>.value(
            value: ModuleProvider()..setActive(const [AppModules.tasks]),
          ),
          ChangeNotifierProvider<NotificationProvider>.value(
            value: NotificationProvider(NotificationService(_client(mock))),
          ),
          ChangeNotifierProvider<TaskProvider>.value(value: TaskProvider(TaskService(_client(mock)))),
        ],
        child: const MaterialApp(
          home: MediaQuery(
            data: MediaQueryData(size: Size(1000, 800)),
            child: TaskListScreen(),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    // Before selection the detail pane shows the empty-state placeholder.
    expect(find.text('Nothing selected'), findsOneWidget);
    // Selecting a task fills the detail pane in place (no full-screen push).
    await tester.tap(find.text('T-1'));
    await tester.pumpAndSettle();
    expect(find.text('Steps'), findsOneWidget);
    expect(find.text('Chop'), findsOneWidget);
    // The list pane is still present, so the title shows in both list and pane header.
    expect(find.text('T-1'), findsWidgets);
  });
}
