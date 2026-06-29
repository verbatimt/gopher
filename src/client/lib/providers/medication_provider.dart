import 'dart:async';

import '../models/medication.dart';
import '../services/medication_service.dart';
import 'base_provider.dart';

/// Medication schedules + dose/refill actions. Live-refreshes and raises a transient
/// `lastReminder` when a `medication.reminder` WS event arrives (EP-0025/0026).
class MedicationProvider extends BaseProvider {
  final MedicationService _service;
  StreamSubscription<Map<String, dynamic>>? _wsSub;

  String? _householdId;
  List<MedicationSchedule> _schedules = [];
  String? _lastReminder;

  MedicationProvider(this._service);

  List<MedicationSchedule> get schedules => List.unmodifiable(_schedules);

  /// The most recent live reminder message (cleared by [clearReminder]); null when none.
  String? get lastReminder => _lastReminder;

  Future<void> load(String householdId) async {
    _householdId = householdId;
    final result = await runGuarded(() => _service.listSchedules(householdId));
    if (result != null) {
      _schedules = result;
      notifyListeners();
    }
  }

  Future<MedicationSchedule?> fetchSchedule(String scheduleId) async {
    if (_householdId == null) return null;
    return runGuarded(() => _service.getSchedule(_householdId!, scheduleId));
  }

  Future<bool> createSchedule(Map<String, dynamic> body) async {
    if (_householdId == null) return false;
    final created = await runGuarded(() => _service.createSchedule(_householdId!, body));
    if (created == null) return false;
    await load(_householdId!);
    return true;
  }

  Future<bool> updateSchedule(String scheduleId, Map<String, dynamic> body) async {
    if (_householdId == null) return false;
    final updated = await runGuarded(() => _service.updateSchedule(_householdId!, scheduleId, body));
    if (updated == null) return false;
    await load(_householdId!);
    return true;
  }

  Future<List<MedicationDose>> doses(String scheduleId) async {
    if (_householdId == null) return const [];
    return await runGuarded(() => _service.listDoses(_householdId!, scheduleId)) ?? const [];
  }

  Future<MedicationDose?> logDose(String scheduleId, Map<String, dynamic> body) async {
    if (_householdId == null) return null;
    final dose = await runGuarded(() => _service.logDose(_householdId!, scheduleId, body));
    if (dose != null) await load(_householdId!);
    return dose;
  }

  Future<List<MedicationRefill>> refills(String scheduleId) async {
    if (_householdId == null) return const [];
    return await runGuarded(() => _service.listRefills(_householdId!, scheduleId)) ?? const [];
  }

  Future<bool> logRefill(String scheduleId, Map<String, dynamic> body) async {
    if (_householdId == null) return false;
    final updated = await runGuarded(() => _service.logRefill(_householdId!, scheduleId, body));
    if (updated == null) return false;
    await load(_householdId!);
    return true;
  }

  Future<MedicationCompliance?> compliance(String scheduleId, {String? from, String? to}) async {
    if (_householdId == null) return null;
    return runGuarded(() => _service.getCompliance(_householdId!, scheduleId, from: from, to: to));
  }

  /// Listen to the WS stream; on `medication.reminder` surface a message and refresh stock.
  void bindEvents(Stream<Map<String, dynamic>> events) {
    _wsSub?.cancel();
    _wsSub = events.listen((event) {
      if (event['type'] != 'medication.reminder') return;
      final payload = (event['payload'] as Map?)?.cast<String, dynamic>();
      final name = payload?['medicationName'] as String?;
      _lastReminder = name != null ? 'Time for $name' : 'Medication reminder';
      notifyListeners();
      if (_householdId != null) load(_householdId!);
    });
  }

  void clearReminder() {
    _lastReminder = null;
  }

  @override
  void dispose() {
    _wsSub?.cancel();
    super.dispose();
  }
}
