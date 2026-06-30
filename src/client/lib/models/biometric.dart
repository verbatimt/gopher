// Biometric/vitals domain models mirroring the EP-0043 API. Stored numeric fields arrive as
// strings (Postgres `numeric`); computed trend aggregates arrive as numbers. `_numOf` parses
// either form.

double? _numOrNull(dynamic v) => v == null ? null : double.tryParse(v.toString());
double _numOf(dynamic v) => _numOrNull(v) ?? 0;

/// A measurement type in the catalog (system default or household-custom).
class MeasurementType {
  final String id;
  final String? householdId;
  final String key;
  final String displayName;
  final String valueShape; // 'single' | 'dual'
  final String unitDefault;
  final int precision;
  final double? minNormal;
  final double? maxNormal;
  final bool isSystemDefault;

  const MeasurementType({
    required this.id,
    this.householdId,
    required this.key,
    required this.displayName,
    required this.valueShape,
    required this.unitDefault,
    required this.precision,
    this.minNormal,
    this.maxNormal,
    required this.isSystemDefault,
  });

  bool get isDual => valueShape == 'dual';

  factory MeasurementType.fromJson(Map<String, dynamic> json) => MeasurementType(
        id: json['id'] as String,
        householdId: json['householdId'] as String?,
        key: json['key'] as String? ?? '',
        displayName: json['displayName'] as String? ?? '',
        valueShape: json['valueShape'] as String? ?? 'single',
        unitDefault: json['unitDefault'] as String? ?? '',
        precision: (json['precision'] as num?)?.toInt() ?? 1,
        minNormal: _numOrNull(json['minNormal']),
        maxNormal: _numOrNull(json['maxNormal']),
        isSystemDefault: json['isSystemDefault'] as bool? ?? (json['householdId'] == null),
      );
}

/// A single recorded reading.
class Measurement {
  final String id;
  final String memberId;
  final String typeId;
  final String? typeKey;
  final double value;
  final double? valueSecondary;
  final String unit;
  final DateTime measuredAt;
  final String? notes;
  final String? recordedBy;

  const Measurement({
    required this.id,
    required this.memberId,
    required this.typeId,
    this.typeKey,
    required this.value,
    this.valueSecondary,
    required this.unit,
    required this.measuredAt,
    this.notes,
    this.recordedBy,
  });

  factory Measurement.fromJson(Map<String, dynamic> json) => Measurement(
        id: json['id'] as String,
        memberId: json['memberId'] as String? ?? '',
        typeId: json['typeId'] as String? ?? '',
        typeKey: json['typeKey'] as String?,
        value: _numOf(json['valueNumeric']),
        valueSecondary: _numOrNull(json['valueSecondary']),
        unit: json['unit'] as String? ?? '',
        measuredAt: DateTime.tryParse(json['measuredAt'] as String? ?? '') ??
            DateTime.fromMillisecondsSinceEpoch(0),
        notes: json['notes'] as String?,
        recordedBy: json['recordedBy'] as String?,
      );
}

/// One point in a trend series.
class TrendPoint {
  final DateTime measuredAt;
  final double value;
  final double? valueSecondary;

  const TrendPoint({required this.measuredAt, required this.value, this.valueSecondary});

  factory TrendPoint.fromJson(Map<String, dynamic> json) => TrendPoint(
        measuredAt: DateTime.tryParse(json['measuredAt'] as String? ?? '') ??
            DateTime.fromMillisecondsSinceEpoch(0),
        value: _numOf(json['value']),
        valueSecondary: _numOrNull(json['valueSecondary']),
      );
}

/// Per-type trend aggregation over a range.
class MeasurementTrend {
  final String typeKey;
  final int count;
  final TrendPoint? latest;
  final double? min;
  final double? max;
  final double? avg;
  final double adherencePct;
  final List<TrendPoint> series;

  const MeasurementTrend({
    required this.typeKey,
    required this.count,
    this.latest,
    this.min,
    this.max,
    this.avg,
    required this.adherencePct,
    required this.series,
  });

  factory MeasurementTrend.fromJson(Map<String, dynamic> json) {
    final latest = json['latest'];
    return MeasurementTrend(
      typeKey: json['typeKey'] as String? ?? '',
      count: (json['count'] as num?)?.toInt() ?? 0,
      latest: latest is Map ? TrendPoint.fromJson(latest.cast<String, dynamic>()) : null,
      min: _numOrNull(json['min']),
      max: _numOrNull(json['max']),
      avg: _numOrNull(json['avg']),
      adherencePct: _numOf(json['adherencePct']),
      series: ((json['series'] as List?) ?? const [])
          .map((e) => TrendPoint.fromJson((e as Map).cast<String, dynamic>()))
          .toList(),
    );
  }
}

/// A per-member, per-type goal range.
class MeasurementTarget {
  final String id;
  final String memberId;
  final String typeId;
  final String? typeKey;
  final double? minTarget;
  final double? maxTarget;
  final double? goalValue;

  const MeasurementTarget({
    required this.id,
    required this.memberId,
    required this.typeId,
    this.typeKey,
    this.minTarget,
    this.maxTarget,
    this.goalValue,
  });

  factory MeasurementTarget.fromJson(Map<String, dynamic> json) => MeasurementTarget(
        id: json['id'] as String,
        memberId: json['memberId'] as String? ?? '',
        typeId: json['typeId'] as String? ?? '',
        typeKey: json['typeKey'] as String?,
        minTarget: _numOrNull(json['minTarget']),
        maxTarget: _numOrNull(json['maxTarget']),
        goalValue: _numOrNull(json['goalValue']),
      );
}
