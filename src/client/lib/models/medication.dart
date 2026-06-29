// Medication domain models mirroring the EP-0024/0025 API. Numeric server fields (dosage,
// stock, threshold) arrive as strings (Postgres `numeric`); parsed to doubles for display.

double _numOf(dynamic v) => v == null ? 0 : double.tryParse(v.toString()) ?? 0;

/// A medication schedule: a dosing recurrence with stock + refill tracking.
class MedicationSchedule {
  final String id;
  final String memberId;
  final String medicationName;
  final String dosageAmount;
  final String dosageUnit;
  final String rrule;
  final String startDate;
  final String? endDate;
  final String stockQuantity;
  final String refillThreshold;
  final int doseWindowMinutes;
  final String? notes;
  final bool isActive;

  const MedicationSchedule({
    required this.id,
    required this.memberId,
    required this.medicationName,
    required this.dosageAmount,
    required this.dosageUnit,
    required this.rrule,
    required this.startDate,
    this.endDate,
    required this.stockQuantity,
    required this.refillThreshold,
    required this.doseWindowMinutes,
    this.notes,
    required this.isActive,
  });

  double get stock => _numOf(stockQuantity);
  double get threshold => _numOf(refillThreshold);

  /// Stock has fallen to/below the refill threshold.
  bool get isLowStock => stock <= threshold;

  String get dosageLabel => '${_trim(dosageAmount)} $dosageUnit';

  static String _trim(String n) {
    final d = double.tryParse(n);
    if (d == null) return n;
    return d == d.roundToDouble() ? d.toInt().toString() : d.toString();
  }

  factory MedicationSchedule.fromJson(Map<String, dynamic> json) => MedicationSchedule(
        id: json['id'] as String,
        memberId: json['memberId'] as String? ?? '',
        medicationName: json['medicationName'] as String? ?? '',
        dosageAmount: (json['dosageAmount'] ?? '0').toString(),
        dosageUnit: json['dosageUnit'] as String? ?? '',
        rrule: json['rrule'] as String? ?? '',
        startDate: json['startDate'] as String? ?? '',
        endDate: json['endDate'] as String?,
        stockQuantity: (json['stockQuantity'] ?? '0').toString(),
        refillThreshold: (json['refillThreshold'] ?? '0').toString(),
        doseWindowMinutes: (json['doseWindowMinutes'] as num?)?.toInt() ?? 120,
        notes: json['notes'] as String?,
        isActive: json['isActive'] as bool? ?? true,
      );
}

/// A single dose occurrence (pending until taken/skipped/missed).
class MedicationDose {
  final String id;
  final String scheduleId;
  final DateTime scheduledAt;
  final String status;
  final DateTime? loggedAt;
  final String? notes;

  const MedicationDose({
    required this.id,
    required this.scheduleId,
    required this.scheduledAt,
    required this.status,
    this.loggedAt,
    this.notes,
  });

  factory MedicationDose.fromJson(Map<String, dynamic> json) => MedicationDose(
        id: json['id'] as String,
        scheduleId: json['scheduleId'] as String? ?? '',
        scheduledAt:
            DateTime.tryParse(json['scheduledAt'] as String? ?? '') ?? DateTime.fromMillisecondsSinceEpoch(0),
        status: json['status'] as String? ?? 'pending',
        loggedAt: (json['loggedAt'] as String?) != null ? DateTime.tryParse(json['loggedAt'] as String) : null,
        notes: json['notes'] as String?,
      );
}

/// A logged refill that added stock.
class MedicationRefill {
  final String id;
  final String scheduleId;
  final String refillDate;
  final String quantityAdded;
  final String? notes;

  const MedicationRefill({
    required this.id,
    required this.scheduleId,
    required this.refillDate,
    required this.quantityAdded,
    this.notes,
  });

  factory MedicationRefill.fromJson(Map<String, dynamic> json) => MedicationRefill(
        id: json['id'] as String,
        scheduleId: json['scheduleId'] as String? ?? '',
        refillDate: json['refillDate'] as String? ?? '',
        quantityAdded: (json['quantityAdded'] ?? '0').toString(),
        notes: json['notes'] as String?,
      );
}

/// Per-schedule adherence summary (EP-0025 compliance endpoint).
class MedicationCompliance {
  final int taken;
  final int skipped;
  final int missed;
  final int pending;
  final int total;
  final double adherencePct;

  const MedicationCompliance({
    required this.taken,
    required this.skipped,
    required this.missed,
    required this.pending,
    required this.total,
    required this.adherencePct,
  });

  factory MedicationCompliance.fromJson(Map<String, dynamic> json) {
    final counts = (json['counts'] as Map?)?.cast<String, dynamic>() ?? const {};
    return MedicationCompliance(
      taken: (counts['taken'] as num?)?.toInt() ?? 0,
      skipped: (counts['skipped'] as num?)?.toInt() ?? 0,
      missed: (counts['missed'] as num?)?.toInt() ?? 0,
      pending: (counts['pending'] as num?)?.toInt() ?? 0,
      total: (json['total'] as num?)?.toInt() ?? 0,
      adherencePct: _numOf(json['adherencePct']),
    );
  }
}
