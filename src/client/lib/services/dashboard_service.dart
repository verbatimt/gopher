import '../core/api/api_client.dart';
import '../models/dashboard.dart';

/// Transport for the aggregated dashboard (EP-0031). Household is resolved server-side from
/// the token, so the path carries no household id.
class DashboardService {
  final ApiClient _api;

  DashboardService(this._api);

  Future<DashboardData> fetch() => _api.getEnveloped(
        '/api/v1/dashboard',
        (r) => DashboardData.fromJson((r as Map).cast<String, dynamic>()),
      );
}
