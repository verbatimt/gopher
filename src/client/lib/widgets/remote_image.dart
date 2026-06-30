import 'package:flutter/material.dart';

/// Renders an image from a URL (e.g. a recipe or inventory item photo; uploads are deferred —
/// ADR-0006). Shows a themed placeholder (with [placeholderIcon]) when no path is set, while the
/// image loads, or if the URL fails — so a broken or unreachable URL degrades gracefully instead
/// of crashing.
class RemoteImage extends StatelessWidget {
  final String? path;
  final double height;
  final double? width;
  final BoxFit fit;
  final double radius;
  final IconData placeholderIcon;

  const RemoteImage({
    super.key,
    required this.path,
    required this.height,
    this.width,
    this.fit = BoxFit.cover,
    this.radius = 8,
    this.placeholderIcon = Icons.image_outlined,
  });

  @override
  Widget build(BuildContext context) {
    final url = path?.trim();
    final Widget child = (url == null || url.isEmpty)
        ? _placeholder(context)
        : Image.network(
            url,
            height: height,
            width: width,
            fit: fit,
            errorBuilder: (_, _, _) => _placeholder(context),
            loadingBuilder: (context, child, progress) =>
                progress == null ? child : _placeholder(context),
          );
    return ClipRRect(borderRadius: BorderRadius.circular(radius), child: child);
  }

  Widget _placeholder(BuildContext context) {
    return Container(
      height: height,
      width: width,
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      alignment: Alignment.center,
      child: Icon(placeholderIcon, color: Theme.of(context).colorScheme.onSurfaceVariant),
    );
  }
}
