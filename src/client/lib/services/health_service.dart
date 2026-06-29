import '../core/api/api_client.dart';
import '../core/api/api_exception.dart';
import '../models/health_status.dart';

/// Per-domain service: fetches the API `/health` diagnostic. Demonstrates the
/// service → ApiClient layering every feature follows.
class HealthService {
  final ApiClient _api;

  HealthService(this._api);

  Future<HealthStatus> fetch() async {
    final raw = await _api.getRaw('/health');
    if (raw is! Map) {
      throw const ApiException(0, 'The server returned an unexpected health response.');
    }
    return HealthStatus.fromJson(raw.cast<String, dynamic>());
  }
}
