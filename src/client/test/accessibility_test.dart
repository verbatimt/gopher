// Accessibility + responsiveness tests (EP-0039): the net-worth chart exposes a semantics
// label, the adaptive shell uses an extended rail only at expanded width, and key widgets
// stay renderable under large text scaling.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gopher/screens/shell/app_shell.dart';
import 'package:gopher/widgets/net_worth_chart.dart';
import 'package:gopher/widgets/status_badge.dart';

Widget _shell(Size size) => MaterialApp(
      home: MediaQuery(
        data: MediaQueryData(size: size),
        child: const AppShell(location: '/dashboard', child: Text('body')),
      ),
    );

void main() {
  testWidgets('the net-worth chart exposes a descriptive semantics label', (tester) async {
    final handle = tester.ensureSemantics();
    await tester.pumpWidget(
      const MaterialApp(home: Scaffold(body: NetWorthChart(values: [100, 200, 150]))),
    );
    expect(find.bySemanticsLabel(RegExp('Net worth over time')), findsOneWidget);
    handle.dispose();
  });

  testWidgets('the adaptive shell extends the rail only at expanded width', (tester) async {
    await tester.pumpWidget(_shell(const Size(700, 800))); // medium
    expect(find.byType(NavigationRail), findsOneWidget);
    expect(tester.widget<NavigationRail>(find.byType(NavigationRail)).extended, isFalse);

    await tester.pumpWidget(_shell(const Size(1100, 800))); // expanded
    expect(tester.widget<NavigationRail>(find.byType(NavigationRail)).extended, isTrue);
  });

  testWidgets('key widgets remain renderable at large text scale', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: MediaQuery(
          data: MediaQueryData(textScaler: TextScaler.linear(2.5)),
          child: Scaffold(
            body: Center(child: StatusBadge('Overdue', tone: StatusTone.danger)),
          ),
        ),
      ),
    );
    expect(tester.takeException(), isNull);
  });
}
