import '../core/api/api_client.dart';
import '../models/biometric.dart';

/// Transport for the biometrics/vitals API (EP-0043). Mirrors the server routes under
/// `/api/v1/households/:id/...`.
class BiometricService {
  final ApiClient _api;

  BiometricService(this._api);

  String _base(String householdId) => '/api/v1/households/$householdId';

  Future<List<MeasurementType>> listTypes(String householdId) {
    return _api.getEnveloped('${_base(householdId)}/measurement-types', (r) {
      final list = (r as Map)['types'] as List;
      return list
          .map((e) => MeasurementType.fromJson((e as Map).cast<String, dynamic>()))
          .toList();
    });
  }

  Future<MeasurementType> createType(String householdId, Map<String, dynamic> body) {
    return _api.postEnveloped(
      '${_base(householdId)}/measurement-types',
      body,
      (r) => MeasurementType.fromJson(((r as Map)['type'] as Map).cast<String, dynamic>()),
    );
  }

  Future<List<Measurement>> listMeasurements(
    String householdId,
    String memberId, {
    String? typeKey,
    String? from,
    String? to,
    int? page,
  }) {
    final params = <String>[];
    if (typeKey != null) params.add('typeKey=$typeKey');
    if (from != null) params.add('from=$from');
    if (to != null) params.add('to=$to');
    if (page != null) params.add('page=$page');
    final query = params.isEmpty ? '' : '?${params.join('&')}';
    return _api.getEnveloped('${_base(householdId)}/members/$memberId/measurements$query', (r) {
      final list = (r as Map)['measurements'] as List;
      return list.map((e) => Measurement.fromJson((e as Map).cast<String, dynamic>())).toList();
    });
  }

  Future<Measurement> recordMeasurement(
    String householdId,
    String memberId,
    Map<String, dynamic> body,
  ) {
    return _api.postEnveloped(
      '${_base(householdId)}/members/$memberId/measurements',
      body,
      (r) => Measurement.fromJson(((r as Map)['measurement'] as Map).cast<String, dynamic>()),
    );
  }

  Future<Measurement> updateMeasurement(
    String householdId,
    String memberId,
    String measurementId,
    Map<String, dynamic> body,
  ) {
    return _api.patchEnveloped(
      '${_base(householdId)}/members/$memberId/measurements/$measurementId',
      body,
      (r) => Measurement.fromJson(((r as Map)['measurement'] as Map).cast<String, dynamic>()),
    );
  }

  Future<void> deleteMeasurement(String householdId, String memberId, String measurementId) {
    return _api.deleteEnveloped(
      '${_base(householdId)}/members/$memberId/measurements/$measurementId',
      (_) {},
    );
  }

  Future<MeasurementTrend> getTrends(
    String householdId,
    String memberId, {
    required String typeKey,
    String? from,
    String? to,
  }) {
    final params = <String>['typeKey=$typeKey'];
    if (from != null) params.add('from=$from');
    if (to != null) params.add('to=$to');
    return _api.getEnveloped(
      '${_base(householdId)}/members/$memberId/measurements/trends?${params.join('&')}',
      (r) => MeasurementTrend.fromJson(((r as Map)['trends'] as Map).cast<String, dynamic>()),
    );
  }

  Future<List<MeasurementTarget>> listTargets(String householdId, String memberId) {
    return _api.getEnveloped('${_base(householdId)}/members/$memberId/measurement-targets', (r) {
      final list = (r as Map)['targets'] as List;
      return list
          .map((e) => MeasurementTarget.fromJson((e as Map).cast<String, dynamic>()))
          .toList();
    });
  }

  Future<MeasurementTarget> upsertTarget(
    String householdId,
    String memberId,
    String typeKey,
    Map<String, dynamic> body,
  ) {
    return _api.putEnveloped(
      '${_base(householdId)}/members/$memberId/measurement-targets/$typeKey',
      body,
      (r) => MeasurementTarget.fromJson(((r as Map)['target'] as Map).cast<String, dynamic>()),
    );
  }
}
