import 'package:flutter/material.dart';

/// Circular avatar showing a member's initials, tinted from a small token palette keyed
/// by the name. Used wherever a household member is represented compactly.
class MemberAvatar extends StatelessWidget {
  final String name;
  final double radius;

  const MemberAvatar({super.key, required this.name, this.radius = 20});

  String get _initials {
    final parts = name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
    if (parts.isEmpty) return '?';
    final first = parts.first[0];
    final last = parts.length > 1 ? parts.last[0] : '';
    return (first + last).toUpperCase();
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final palette = [
      (scheme.primaryContainer, scheme.onPrimaryContainer),
      (scheme.secondaryContainer, scheme.onSecondaryContainer),
      (scheme.tertiaryContainer, scheme.onTertiaryContainer),
    ];
    final (background, foreground) = palette[name.hashCode.abs() % palette.length];
    return CircleAvatar(
      radius: radius,
      backgroundColor: background,
      child: Text(
        _initials,
        style: TextStyle(color: foreground, fontSize: radius * 0.7),
      ),
    );
  }
}
