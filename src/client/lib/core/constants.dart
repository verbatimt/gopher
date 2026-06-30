/// App-wide constants. Hosts are never hardcoded: the API base URL is injected at build
/// time via `--dart-define=API_BASE_URL` (default points at the LAN API host).
class AppConstants {
  AppConstants._();

  static const String appName = 'Gopher';

  /// Resolved at build time; defaults to the LAN API hostname.
  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://gopher-api.local',
  );

  // Material 3 adaptive breakpoints (logical pixels).
  /// Below this width the shell uses a bottom NavigationBar; at/above it uses a rail.
  static const double compactMaxWidth = 600;

  /// At/above this width the navigation rail is shown extended (icon + label).
  static const double extendedRailMinWidth = 1000;
}

/// Identifiers for the gateable feature modules. A household's `active_modules`
/// (populated in EP-0014/0015) drives which modules are visible via [ModuleGuard].
class AppModules {
  AppModules._();

  static const String dashboard = 'dashboard';
  static const String calendar = 'calendar';
  static const String tasks = 'tasks';
  static const String medications = 'medications';
  static const String health = 'health';
  static const String rewards = 'rewards';
  static const String meals = 'meals';
  static const String inventory = 'inventory';
  static const String finance = 'finance';

  static const List<String> all = <String>[
    dashboard,
    calendar,
    tasks,
    medications,
    health,
    rewards,
    meals,
    inventory,
    finance,
  ];
}
