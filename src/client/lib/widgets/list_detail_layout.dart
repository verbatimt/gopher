import 'package:flutter/material.dart';

import '../core/constants.dart';
import 'empty_state.dart';

/// Material 3 canonical **list-detail** layout.
///
/// On compact/medium windows (`width < paneBreakpoint`) it renders only the
/// list; the caller is expected to open the detail full-screen (e.g. via
/// `context.push`). On expanded windows (`width >= paneBreakpoint`, default
/// the MD3 expanded class at 840dp) it renders the canonical two side-by-side
/// panes: a fixed-width list pane on the leading edge and the selected item's
/// detail filling the remaining space.
///
/// The decision keys off [MediaQuery] width — the same source of truth the
/// adaptive shell uses — so `listBuilder` receives an `isTwoPane` flag and can
/// switch a tap between "select in the pane" and "push a full-screen route".
class ListDetailLayout extends StatelessWidget {
  /// Builds the list pane. `isTwoPane` is true when the detail pane is visible
  /// alongside it, so the list can highlight the selection and select in place
  /// instead of pushing a full-screen detail route.
  final Widget Function(BuildContext context, bool isTwoPane) listBuilder;

  /// The selected item's detail content (no Scaffold/AppBar of its own). When
  /// null in two-pane mode, [placeholder] (or a default empty state) is shown.
  final Widget? detail;

  /// Shown in the detail pane when nothing is selected (two-pane only).
  final Widget? placeholder;

  /// Width at/above which the two-pane layout is used. Defaults to the MD3
  /// expanded window size class lower bound.
  final double paneBreakpoint;

  /// Fixed width of the leading list pane (MD3 recommends ~360dp).
  final double listPaneWidth;

  const ListDetailLayout({
    super.key,
    required this.listBuilder,
    this.detail,
    this.placeholder,
    this.paneBreakpoint = AppConstants.expandedMinWidth,
    this.listPaneWidth = 360,
  });

  /// Whether the current window is wide enough to show both panes.
  static bool isTwoPane(
    BuildContext context, {
    double paneBreakpoint = AppConstants.expandedMinWidth,
  }) =>
      MediaQuery.sizeOf(context).width >= paneBreakpoint;

  @override
  Widget build(BuildContext context) {
    if (!isTwoPane(context, paneBreakpoint: paneBreakpoint)) {
      return listBuilder(context, false);
    }
    return Row(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SizedBox(width: listPaneWidth, child: listBuilder(context, true)),
        const VerticalDivider(width: 1, thickness: 1),
        Expanded(child: detail ?? placeholder ?? const DetailPanePlaceholder()),
      ],
    );
  }
}

/// Default empty state for the detail pane when no item is selected.
class DetailPanePlaceholder extends StatelessWidget {
  final String message;

  const DetailPanePlaceholder({
    super.key,
    this.message = 'Select an item to see its details.',
  });

  @override
  Widget build(BuildContext context) {
    return EmptyState(
      icon: Icons.touch_app_outlined,
      title: 'Nothing selected',
      message: message,
    );
  }
}
