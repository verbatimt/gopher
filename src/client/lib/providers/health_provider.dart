import '../models/health_status.dart';
import '../services/health_service.dart';
import 'base_provider.dart';

/// Drives the sample `/health` connectivity card on the dashboard. On failure, `error`
/// is set (surfaced via snackbar) and `status` is left unchanged.
class HealthProvider extends BaseProvider {
  final HealthService _service;

  HealthStatus? _status;

  HealthProvider(this._service);

  HealthStatus? get status => _status;

  Future<void> refresh() async {
    final result = await runGuarded(() => _service.fetch());
    if (result != null) {
      _status = result;
      notifyListeners();
    }
  }
}
