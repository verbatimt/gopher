import 'package:flutter/foundation.dart';

import '../core/api/api_exception.dart';

/// Base for all providers. Exposes loading (`isBusy`) and `error` state and helpers for
/// guarded async actions and optimistic updates, so feature providers stay consistent.
abstract class BaseProvider extends ChangeNotifier {
  bool _isBusy = false;
  String? _error;

  bool get isBusy => _isBusy;
  String? get error => _error;
  bool get hasError => _error != null;

  /// Run [action] with loading + error handling. Returns null on failure (error is set).
  @protected
  Future<T?> runGuarded<T>(Future<T> Function() action) async {
    _setBusy(true);
    _error = null;
    try {
      return await action();
    } on ApiException catch (e) {
      _error = e.message;
      return null;
    } catch (e) {
      _error = e.toString();
      return null;
    } finally {
      _setBusy(false);
    }
  }

  /// Apply an optimistic change immediately; roll back if [commit] fails.
  @protected
  Future<bool> optimistic({
    required VoidCallback apply,
    required VoidCallback rollback,
    required Future<void> Function() commit,
  }) async {
    apply();
    notifyListeners();
    try {
      await commit();
      return true;
    } catch (e) {
      rollback();
      _error = e is ApiException ? e.message : e.toString();
      notifyListeners();
      return false;
    }
  }

  void clearError() {
    _error = null;
    notifyListeners();
  }

  void _setBusy(bool value) {
    _isBusy = value;
    notifyListeners();
  }
}
