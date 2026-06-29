import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gopher/screens/shell/app_shell.dart';

Widget _wrap(Size size) => MaterialApp(
      home: MediaQuery(
        data: MediaQueryData(size: size),
        child: const AppShell(location: '/dashboard', child: Text('body')),
      ),
    );

void main() {
  testWidgets('compact width shows a bottom NavigationBar (not a rail)', (tester) async {
    await tester.pumpWidget(_wrap(const Size(400, 800)));
    expect(find.byType(NavigationBar), findsOneWidget);
    expect(find.byType(NavigationRail), findsNothing);
  });

  testWidgets('expanded width shows a NavigationRail (not a bottom bar)', (tester) async {
    await tester.pumpWidget(_wrap(const Size(1100, 800)));
    expect(find.byType(NavigationRail), findsOneWidget);
    expect(find.byType(NavigationBar), findsNothing);
  });
}
