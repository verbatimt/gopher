import '../core/api/api_client.dart';
import '../models/medication.dart';

/// Transport for the medications API (EP-0024/0025). Mirrors the server routes under
/// `/api/v1/households/:id/medications`.
class MedicationService {
  final ApiClient _api;

  MedicationService(this._api);

  String _base(String householdId) => '/api/v1/households/$householdId/medications';

  Future<List<MedicationSchedule>> listSchedules(String householdId) {
    return _api.getEnveloped(_base(householdId), (r) {
      final list = (r as Map)['schedules'] as List;
      return list
          .map((e) => MedicationSchedule.fromJson((e as Map).cast<String, dynamic>()))
          .toList();
    });
  }

  Future<MedicationSchedule> getSchedule(String householdId, String scheduleId) {
    return _api.getEnveloped(
      '${_base(householdId)}/$scheduleId',
      (r) => MedicationSchedule.fromJson(((r as Map)['schedule'] as Map).cast<String, dynamic>()),
    );
  }

  Future<MedicationSchedule> createSchedule(String householdId, Map<String, dynamic> body) {
    return _api.postEnveloped(
      _base(householdId),
      body,
      (r) => MedicationSchedule.fromJson(((r as Map)['schedule'] as Map).cast<String, dynamic>()),
    );
  }

  Future<MedicationSchedule> updateSchedule(
    String householdId,
    String scheduleId,
    Map<String, dynamic> body,
  ) {
    return _api.patchEnveloped(
      '${_base(householdId)}/$scheduleId',
      body,
      (r) => MedicationSchedule.fromJson(((r as Map)['schedule'] as Map).cast<String, dynamic>()),
    );
  }

  Future<List<MedicationDose>> listDoses(String householdId, String scheduleId) {
    return _api.getEnveloped('${_base(householdId)}/$scheduleId/doses', (r) {
      final list = (r as Map)['doses'] as List;
      return list.map((e) => MedicationDose.fromJson((e as Map).cast<String, dynamic>())).toList();
    });
  }

  Future<MedicationDose> logDose(String householdId, String scheduleId, Map<String, dynamic> body) {
    return _api.postEnveloped(
      '${_base(householdId)}/$scheduleId/doses',
      body,
      (r) => MedicationDose.fromJson(((r as Map)['dose'] as Map).cast<String, dynamic>()),
    );
  }

  Future<List<MedicationRefill>> listRefills(String householdId, String scheduleId) {
    return _api.getEnveloped('${_base(householdId)}/$scheduleId/refills', (r) {
      final list = (r as Map)['refills'] as List;
      return list.map((e) => MedicationRefill.fromJson((e as Map).cast<String, dynamic>())).toList();
    });
  }

  /// Log a refill; returns the updated schedule (with the new stock total).
  Future<MedicationSchedule> logRefill(
    String householdId,
    String scheduleId,
    Map<String, dynamic> body,
  ) {
    return _api.postEnveloped(
      '${_base(householdId)}/$scheduleId/refills',
      body,
      (r) => MedicationSchedule.fromJson(((r as Map)['schedule'] as Map).cast<String, dynamic>()),
    );
  }

  Future<MedicationCompliance> getCompliance(
    String householdId,
    String scheduleId, {
    String? from,
    String? to,
  }) {
    final params = <String>[];
    if (from != null) params.add('from=$from');
    if (to != null) params.add('to=$to');
    final query = params.isEmpty ? '' : '?${params.join('&')}';
    return _api.getEnveloped(
      '${_base(householdId)}/$scheduleId/compliance$query',
      (r) =>
          MedicationCompliance.fromJson(((r as Map)['compliance'] as Map).cast<String, dynamic>()),
    );
  }
}
