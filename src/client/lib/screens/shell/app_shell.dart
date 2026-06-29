import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/constants.dart';
import 'destinations.dart';

/// Adaptive navigation shell. Renders a bottom [NavigationBar] at compact width and a
/// [NavigationRail] (extended at large widths) at medium/expanded width, per MD3
/// breakpoints. The selected destination is derived from the current route.
class AppShell extends StatelessWidget {
  final String location;
  final Widget child;

  const AppShell({super.key, required this.location, required this.child});

  int get _selectedIndex {
    final index = appDestinations.indexWhere((d) => location.startsWith(d.route));
    return index < 0 ? 0 : index;
  }

  void _onSelect(BuildContext context, int index) {
    context.go(appDestinations[index].route);
  }

  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;
    final useRail = width >= AppConstants.compactMaxWidth;
    final extended = width >= AppConstants.extendedRailMinWidth;

    if (useRail) {
      return Scaffold(
        body: Row(
          children: [
            NavigationRail(
              selectedIndex: _selectedIndex,
              onDestinationSelected: (index) => _onSelect(context, index),
              extended: extended,
              labelType: extended ? NavigationRailLabelType.none : NavigationRailLabelType.all,
              leading: _RailLeading(extended: extended),
              destinations: [
                for (final d in appDestinations)
                  NavigationRailDestination(
                    icon: Icon(d.icon),
                    selectedIcon: Icon(d.selectedIcon),
                    label: Text(d.label),
                  ),
              ],
            ),
            const VerticalDivider(width: 1),
            Expanded(child: child),
          ],
        ),
      );
    }

    return Scaffold(
      body: child,
      bottomNavigationBar: NavigationBar(
        selectedIndex: _selectedIndex,
        onDestinationSelected: (index) => _onSelect(context, index),
        destinations: [
          for (final d in appDestinations)
            NavigationDestination(
              icon: Icon(d.icon),
              selectedIcon: Icon(d.selectedIcon),
              label: d.label,
            ),
        ],
      ),
    );
  }
}

class _RailLeading extends StatelessWidget {
  final bool extended;

  const _RailLeading({required this.extended});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 12),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.cottage_rounded, color: scheme.primary),
          if (extended) ...[
            const SizedBox(width: 8),
            Text(AppConstants.appName, style: Theme.of(context).textTheme.titleMedium),
          ],
        ],
      ),
    );
  }
}
