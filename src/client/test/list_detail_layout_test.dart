// Canonical M3 list-detail layout: single pane below the expanded breakpoint,
// two side-by-side panes at/above it. Width is driven via MediaQuery, matching
// the adaptive-shell tests.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gopher/widgets/list_detail_layout.dart';

Widget _wrap(Size size, {Widget? detail, Widget? placeholder}) => MaterialApp(
      home: MediaQuery(
        data: MediaQueryData(size: size),
        child: Scaffold(
          body: ListDetailLayout(
            listBuilder: (context, isTwoPane) =>
                Text(isTwoPane ? 'LIST two' : 'LIST one'),
            detail: detail,
            placeholder: placeholder,
          ),
        ),
      ),
    );

void main() {
  testWidgets('compact width shows only the list pane', (tester) async {
    await tester.pumpWidget(
      _wrap(const Size(500, 800),
          detail: const Text('DETAIL'), placeholder: const Text('PLACEHOLDER')),
    );
    expect(find.text('LIST one'), findsOneWidget);
    expect(find.text('DETAIL'), findsNothing);
    expect(find.text('PLACEHOLDER'), findsNothing);
    expect(find.byType(VerticalDivider), findsNothing);
  });

  testWidgets('expanded width shows list + detail side by side', (tester) async {
    await tester.pumpWidget(
      _wrap(const Size(900, 800), detail: const Text('DETAIL')),
    );
    expect(find.text('LIST two'), findsOneWidget);
    expect(find.text('DETAIL'), findsOneWidget);
    expect(find.byType(VerticalDivider), findsOneWidget);
  });

  testWidgets('expanded width with no selection shows the placeholder', (tester) async {
    await tester.pumpWidget(
      _wrap(const Size(900, 800), placeholder: const Text('PLACEHOLDER')),
    );
    expect(find.text('LIST two'), findsOneWidget);
    expect(find.text('PLACEHOLDER'), findsOneWidget);
  });

  testWidgets('expanded width falls back to the default placeholder', (tester) async {
    await tester.pumpWidget(_wrap(const Size(900, 800)));
    expect(find.byType(DetailPanePlaceholder), findsOneWidget);
    expect(find.text('Nothing selected'), findsOneWidget);
  });

  testWidgets('ListDetailLayout.isTwoPane reflects the breakpoint', (tester) async {
    late bool below;
    late bool atOrAbove;
    await tester.pumpWidget(
      MaterialApp(
        home: MediaQuery(
          data: const MediaQueryData(size: Size(839, 800)),
          child: Builder(builder: (context) {
            below = ListDetailLayout.isTwoPane(context);
            return const SizedBox();
          }),
        ),
      ),
    );
    await tester.pumpWidget(
      MaterialApp(
        home: MediaQuery(
          data: const MediaQueryData(size: Size(840, 800)),
          child: Builder(builder: (context) {
            atOrAbove = ListDetailLayout.isTwoPane(context);
            return const SizedBox();
          }),
        ),
      ),
    );
    expect(below, isFalse);
    expect(atOrAbove, isTrue);
  });
}
