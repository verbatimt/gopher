import 'package:flutter/material.dart';

/// Material 3 theming. Light/dark schemes are derived from a single seed color via
/// `ColorScheme.fromSeed`. Screens consume tokens through `Theme.of(context)` — no
/// hardcoded colors anywhere in the UI.
class AppTheme {
  AppTheme._();

  /// Gopher brand seed color.
  static const Color seed = Color(0xFF3B6EA5);

  static ThemeData light() => _build(Brightness.light);
  static ThemeData dark() => _build(Brightness.dark);

  static ThemeData _build(Brightness brightness) {
    final scheme = ColorScheme.fromSeed(seedColor: seed, brightness: brightness);
    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: scheme.surface,
      appBarTheme: AppBarTheme(
        backgroundColor: scheme.surface,
        foregroundColor: scheme.onSurface,
        centerTitle: false,
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: scheme.surfaceContainer,
        indicatorColor: scheme.secondaryContainer,
      ),
      cardTheme: const CardThemeData(clipBehavior: Clip.antiAlias),
      visualDensity: VisualDensity.adaptivePlatformDensity,
    );
  }
}
