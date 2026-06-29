import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gopher/core/api/api_client.dart';
import 'package:gopher/core/storage/in_memory_token_store.dart';
import 'package:gopher/providers/auth_provider.dart';
import 'package:gopher/screens/auth/login_screen.dart';
import 'package:gopher/screens/router.dart';
import 'package:gopher/services/auth_service.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';

AuthProvider _auth() {
  final store = InMemoryTokenStore();
  final mock = MockClient((req) async => http.Response('{}', 404));
  return AuthProvider(
    tokenStore: store,
    authService: AuthService(ApiClient(baseUrl: 'http://t', client: mock, tokenStore: store)),
  );
}

void main() {
  testWidgets('login form shows validation errors on empty submit', (tester) async {
    final auth = _auth();
    await tester.pumpWidget(
      MultiProvider(
        providers: [ChangeNotifierProvider<AuthProvider>.value(value: auth)],
        child: const MaterialApp(home: LoginScreen()),
      ),
    );
    await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
    await tester.pump();
    expect(find.text('Email is required'), findsOneWidget);
    expect(find.text('Password is required'), findsOneWidget);
  });

  testWidgets('the auth gate routes an unauthenticated user to login', (tester) async {
    final auth = _auth();
    await auth.init(); // resolves to unauthenticated (no stored token)
    final router = buildRouter(auth);

    await tester.pumpWidget(
      MultiProvider(
        providers: [ChangeNotifierProvider<AuthProvider>.value(value: auth)],
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byType(LoginScreen), findsOneWidget);
  });
}
