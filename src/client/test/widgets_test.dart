import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gopher/widgets/empty_state.dart';
import 'package:gopher/widgets/member_avatar.dart';
import 'package:gopher/widgets/status_badge.dart';

Widget _host(Widget child) => MaterialApp(home: Scaffold(body: child));

void main() {
  testWidgets('EmptyState renders title and message', (tester) async {
    await tester.pumpWidget(
      _host(const EmptyState(icon: Icons.info, title: 'Nothing here', message: 'Add something')),
    );
    expect(find.text('Nothing here'), findsOneWidget);
    expect(find.text('Add something'), findsOneWidget);
  });

  testWidgets('MemberAvatar shows two-letter initials', (tester) async {
    await tester.pumpWidget(_host(const MemberAvatar(name: 'Ada Lovelace')));
    expect(find.text('AL'), findsOneWidget);
  });

  testWidgets('MemberAvatar handles single names', (tester) async {
    await tester.pumpWidget(_host(const MemberAvatar(name: 'Grace')));
    expect(find.text('G'), findsOneWidget);
  });

  testWidgets('StatusBadge renders its label', (tester) async {
    await tester.pumpWidget(_host(const StatusBadge('Active', tone: StatusTone.success)));
    expect(find.text('Active'), findsOneWidget);
  });
}
