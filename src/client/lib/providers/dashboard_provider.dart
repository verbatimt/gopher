import 'dart:async';

import '../models/dashboard.dart';
import '../services/dashboard_service.dart';
import 'base_provider.dart';

/// Aggregated dashboard state. Reloads on any WS event from a module it summarizes so the
/// affected cards refresh without a manual pull (EP-0031).
class DashboardProvider extends BaseProvider {
  final DashboardService _service;
  StreamSubscription<Map<String, dynamic>>? _wsSub;

  DashboardData? _data;

  DashboardProvider(this._service);

  DashboardData? get data => _data;

  static const _refreshOn = {
    'task.updated',
    'reward.updated',
    'medication.reminder',
    'calendar.changed',
    'notification.new',
    'meals.changed',
  };

  Future<void> load() async {
    final result = await runGuarded(() => _service.fetch());
    if (result != null) {
      _data = result;
      notifyListeners();
    }
  }

  void bindEvents(Stream<Map<String, dynamic>> events) {
    _wsSub?.cancel();
    _wsSub = events.listen((event) {
      if (_refreshOn.contains(event['type'])) load();
    });
  }

  @override
  void dispose() {
    _wsSub?.cancel();
    super.dispose();
  }
}
