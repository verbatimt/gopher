import '../models/biometric.dart';
import '../services/biometric_service.dart';
import 'base_provider.dart';

/// Biometric/vitals state (EP-0044): the measurement-type catalog, a selected member's
/// readings + targets, and trend fetches. Self-scoping is enforced server-side; the client
/// addresses the selected member's id.
class BiometricProvider extends BaseProvider {
  final BiometricService _service;

  String? _householdId;
  List<MeasurementType> _types = [];
  List<Measurement> _measurements = [];
  List<MeasurementTarget> _targets = [];

  BiometricProvider(this._service);

  List<MeasurementType> get types => List.unmodifiable(_types);
  List<Measurement> get measurements => List.unmodifiable(_measurements);
  List<MeasurementTarget> get targets => List.unmodifiable(_targets);

  /// Latest reading per type key (measurements are newest-first, so the first wins).
  Map<String, Measurement> get latestByType {
    final out = <String, Measurement>{};
    for (final m in _measurements) {
      final key = m.typeKey;
      if (key != null && !out.containsKey(key)) out[key] = m;
    }
    return out;
  }

  MeasurementType? typeByKey(String key) {
    for (final t in _types) {
      if (t.key == key) return t;
    }
    return null;
  }

  MeasurementTarget? targetByKey(String key) {
    for (final t in _targets) {
      if (t.typeKey == key) return t;
    }
    return null;
  }

  Future<void> loadTypes(String householdId) async {
    _householdId = householdId;
    final result = await runGuarded(() => _service.listTypes(householdId));
    if (result != null) {
      _types = result;
      notifyListeners();
    }
  }

  /// Load a member's measurements (optionally filtered) and their targets.
  Future<void> loadMember(
    String householdId,
    String memberId, {
    String? typeKey,
    String? from,
    String? to,
  }) async {
    _householdId = householdId;
    final result = await runGuarded(() async {
      final m = await _service.listMeasurements(
        householdId,
        memberId,
        typeKey: typeKey,
        from: from,
        to: to,
      );
      final t = await _service.listTargets(householdId, memberId);
      return (m, t);
    });
    if (result != null) {
      _measurements = result.$1;
      _targets = result.$2;
      notifyListeners();
    }
  }

  Future<bool> record(String memberId, Map<String, dynamic> body) async {
    if (_householdId == null) return false;
    final created = await runGuarded(() => _service.recordMeasurement(_householdId!, memberId, body));
    if (created == null) return false;
    // Optimistic prepend (newest-first ordering preserved).
    _measurements = [created, ..._measurements];
    notifyListeners();
    return true;
  }

  Future<bool> updateMeasurement(
    String memberId,
    String measurementId,
    Map<String, dynamic> body,
  ) async {
    if (_householdId == null) return false;
    final updated =
        await runGuarded(() => _service.updateMeasurement(_householdId!, memberId, measurementId, body));
    if (updated == null) return false;
    _measurements = _measurements.map((m) => m.id == measurementId ? updated : m).toList();
    notifyListeners();
    return true;
  }

  Future<bool> deleteMeasurement(String memberId, String measurementId) async {
    if (_householdId == null) return false;
    final ok = await runGuarded(() async {
      await _service.deleteMeasurement(_householdId!, memberId, measurementId);
      return true;
    });
    if (ok != true) return false;
    _measurements = _measurements.where((m) => m.id != measurementId).toList();
    notifyListeners();
    return true;
  }

  Future<MeasurementTrend?> trends(
    String memberId, {
    required String typeKey,
    String? from,
    String? to,
  }) async {
    if (_householdId == null) return null;
    return runGuarded(
      () => _service.getTrends(_householdId!, memberId, typeKey: typeKey, from: from, to: to),
    );
  }

  Future<bool> createType(Map<String, dynamic> body) async {
    if (_householdId == null) return false;
    final created = await runGuarded(() => _service.createType(_householdId!, body));
    if (created == null) return false;
    await loadTypes(_householdId!);
    return true;
  }

  Future<bool> upsertTarget(String memberId, String typeKey, Map<String, dynamic> body) async {
    if (_householdId == null) return false;
    final target = await runGuarded(() => _service.upsertTarget(_householdId!, memberId, typeKey, body));
    if (target == null) return false;
    _targets = [..._targets.where((t) => t.typeKey != typeKey), target];
    notifyListeners();
    return true;
  }
}
