import 'package:flutter/material.dart';

import '../models/biometric.dart';

/// A lightweight MD3 line chart for a vitals trend series (EP-0044). Drawn with a
/// CustomPainter so it needs no external charting dependency (LAN-only ethos). Renders the
/// primary series and, for `dual` types, a second series; optionally shades the target/normal
/// band. Handles 0/1-point series gracefully.
class VitalsTrendChart extends StatelessWidget {
  final List<TrendPoint> series;
  final bool dual;
  final double? bandLow;
  final double? bandHigh;

  const VitalsTrendChart({
    super.key,
    required this.series,
    this.dual = false,
    this.bandLow,
    this.bandHigh,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    if (series.isEmpty) {
      return const SizedBox(height: 180, child: Center(child: Text('No data in range')));
    }
    final first = series.first.value.toStringAsFixed(1);
    final last = series.last.value.toStringAsFixed(1);
    final trend = series.last.value >= series.first.value ? 'rising' : 'falling';
    return Semantics(
      label: 'Trend over time, $trend from $first to $last across ${series.length} points',
      child: SizedBox(
        height: 180,
        child: CustomPaint(
          painter: _TrendPainter(
            series: series,
            dual: dual,
            bandLow: bandLow,
            bandHigh: bandHigh,
            primary: scheme.primary,
            secondary: scheme.tertiary,
            axis: scheme.outlineVariant,
            band: scheme.secondaryContainer.withValues(alpha: 0.4),
          ),
          size: Size.infinite,
        ),
      ),
    );
  }
}

class _TrendPainter extends CustomPainter {
  final List<TrendPoint> series;
  final bool dual;
  final double? bandLow;
  final double? bandHigh;
  final Color primary;
  final Color secondary;
  final Color axis;
  final Color band;

  _TrendPainter({
    required this.series,
    required this.dual,
    required this.bandLow,
    required this.bandHigh,
    required this.primary,
    required this.secondary,
    required this.axis,
    required this.band,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final values = <double>[];
    for (final p in series) {
      values.add(p.value);
      if (dual && p.valueSecondary != null) values.add(p.valueSecondary!);
    }
    if (bandLow != null) values.add(bandLow!);
    if (bandHigh != null) values.add(bandHigh!);
    var minV = values.reduce((a, b) => a < b ? a : b);
    var maxV = values.reduce((a, b) => a > b ? a : b);
    if ((maxV - minV).abs() < 1e-9) {
      minV -= 1;
      maxV += 1;
    }
    final range = maxV - minV;
    const pad = 8.0;
    final w = size.width - pad * 2;
    final h = size.height - pad * 2;

    double yOf(double v) => pad + h * (1 - (v - minV) / range);
    double xOf(int i) =>
        series.length == 1 ? pad + w / 2 : pad + w * (i / (series.length - 1));

    // Shaded target/normal band.
    if (bandLow != null || bandHigh != null) {
      final top = yOf(bandHigh ?? maxV);
      final bottom = yOf(bandLow ?? minV);
      canvas.drawRect(
        Rect.fromLTRB(pad, top, size.width - pad, bottom),
        Paint()..color = band,
      );
    }

    // Baseline axis.
    canvas.drawLine(
      Offset(pad, size.height - pad),
      Offset(size.width - pad, size.height - pad),
      Paint()
        ..color = axis
        ..strokeWidth = 1,
    );

    void drawSeries(double? Function(TrendPoint) pick, Color color) {
      final pts = <Offset>[];
      for (var i = 0; i < series.length; i++) {
        final v = pick(series[i]);
        if (v == null) continue;
        pts.add(Offset(xOf(i), yOf(v)));
      }
      if (pts.isEmpty) return;
      final path = Path()..moveTo(pts.first.dx, pts.first.dy);
      for (var i = 1; i < pts.length; i++) {
        path.lineTo(pts[i].dx, pts[i].dy);
      }
      canvas.drawPath(
        path,
        Paint()
          ..color = color
          ..strokeWidth = 2.5
          ..style = PaintingStyle.stroke,
      );
      final dot = Paint()..color = color;
      for (final p in pts) {
        canvas.drawCircle(p, 3, dot);
      }
    }

    drawSeries((p) => p.value, primary);
    if (dual) drawSeries((p) => p.valueSecondary, secondary);
  }

  @override
  bool shouldRepaint(covariant _TrendPainter old) =>
      old.series != series ||
      old.bandLow != bandLow ||
      old.bandHigh != bandHigh ||
      old.dual != dual;
}
