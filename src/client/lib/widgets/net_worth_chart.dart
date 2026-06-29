import 'package:flutter/material.dart';

/// A lightweight MD3 line chart for the forecast net-worth-over-time series (EP-0035). Drawn
/// with a CustomPainter so it needs no external charting dependency (LAN-only ethos). One
/// vertex per snapshot date.
class NetWorthChart extends StatelessWidget {
  final List<double> values;

  const NetWorthChart({super.key, required this.values});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    if (values.isEmpty) {
      return const SizedBox(height: 160, child: Center(child: Text('No data')));
    }
    // The chart is a CustomPaint (invisible to screen readers); describe the trend in a
    // Semantics label so the data is announced (EP-0039 accessibility).
    final first = values.first.toStringAsFixed(0);
    final last = values.last.toStringAsFixed(0);
    final trend = values.last >= values.first ? 'rising' : 'falling';
    return Semantics(
      label: 'Net worth over time, $trend from $first to $last across ${values.length} points',
      child: SizedBox(
        height: 160,
        child: CustomPaint(
          painter: _LinePainter(values, scheme.primary, scheme.outlineVariant),
          size: Size.infinite,
        ),
      ),
    );
  }
}

class _LinePainter extends CustomPainter {
  final List<double> values;
  final Color line;
  final Color axis;

  _LinePainter(this.values, this.line, this.axis);

  @override
  void paint(Canvas canvas, Size size) {
    final minV = values.reduce((a, b) => a < b ? a : b);
    final maxV = values.reduce((a, b) => a > b ? a : b);
    final range = (maxV - minV).abs() < 1e-9 ? 1.0 : maxV - minV;
    const pad = 8.0;
    final w = size.width - pad * 2;
    final h = size.height - pad * 2;

    final axisPaint = Paint()
      ..color = axis
      ..strokeWidth = 1;
    canvas.drawLine(Offset(pad, size.height - pad), Offset(size.width - pad, size.height - pad), axisPaint);

    Offset at(int i) {
      final x = values.length == 1 ? pad + w / 2 : pad + w * (i / (values.length - 1));
      final y = pad + h * (1 - (values[i] - minV) / range);
      return Offset(x, y);
    }

    final path = Path()..moveTo(at(0).dx, at(0).dy);
    for (var i = 1; i < values.length; i++) {
      path.lineTo(at(i).dx, at(i).dy);
    }
    canvas.drawPath(
      path,
      Paint()
        ..color = line
        ..strokeWidth = 2.5
        ..style = PaintingStyle.stroke,
    );
    final dot = Paint()..color = line;
    for (var i = 0; i < values.length; i++) {
      canvas.drawCircle(at(i), 3, dot);
    }
  }

  @override
  bool shouldRepaint(covariant _LinePainter old) => old.values != values;
}
