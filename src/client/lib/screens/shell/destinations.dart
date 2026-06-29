import 'package:flutter/material.dart';

import '../../core/constants.dart';

/// One navigation destination — the single source of truth shared by the bottom
/// NavigationBar and the NavigationRail.
class AppDestination {
  final String route;
  final String label;
  final IconData icon;
  final IconData selectedIcon;

  const AppDestination({
    required this.route,
    required this.label,
    required this.icon,
    required this.selectedIcon,
  });
}

/// Top-level destinations for the foundation shell. Feature EPs flesh out the screens
/// behind these routes (calendar EP-0023, tasks EP-0023, dashboard EP-0031, …).
const List<AppDestination> appDestinations = <AppDestination>[
  AppDestination(
    route: '/dashboard',
    label: 'Dashboard',
    icon: Icons.dashboard_outlined,
    selectedIcon: Icons.dashboard,
  ),
  AppDestination(
    route: '/calendar',
    label: 'Calendar',
    icon: Icons.calendar_today_outlined,
    selectedIcon: Icons.calendar_today,
  ),
  AppDestination(
    route: '/tasks',
    label: 'Tasks',
    icon: Icons.checklist_outlined,
    selectedIcon: Icons.checklist,
  ),
  AppDestination(
    route: '/more',
    label: 'More',
    icon: Icons.more_horiz_outlined,
    selectedIcon: Icons.more_horiz,
  ),
];

/// Module each destination belongs to (used by per-screen [ModuleGuard]s). Kept here so
/// destinations stay the single source of truth.
const Map<String, String> destinationModules = <String, String>{
  '/dashboard': AppModules.dashboard,
  '/calendar': AppModules.calendar,
  '/tasks': AppModules.tasks,
};
