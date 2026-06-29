import 'package:flutter/material.dart';

enum StatusTone { neutral, success, warning, danger }

/// Compact pill for conveying state (e.g. healthy/degraded, on-track/overdue). Colors
/// come from the active MD3 color scheme.
class StatusBadge extends StatelessWidget {
  final String label;
  final StatusTone tone;

  const StatusBadge(this.label, {super.key, this.tone = StatusTone.neutral});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final (Color background, Color foreground) = switch (tone) {
      StatusTone.success => (scheme.secondaryContainer, scheme.onSecondaryContainer),
      StatusTone.warning => (scheme.tertiaryContainer, scheme.onTertiaryContainer),
      StatusTone.danger => (scheme.errorContainer, scheme.onErrorContainer),
      StatusTone.neutral => (scheme.surfaceContainerHighest, scheme.onSurfaceVariant),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        label,
        style: Theme.of(context).textTheme.labelMedium?.copyWith(color: foreground),
      ),
    );
  }
}
