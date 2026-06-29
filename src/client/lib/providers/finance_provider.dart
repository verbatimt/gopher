import '../models/finance.dart';
import '../services/finance_service.dart';
import 'base_provider.dart';

/// Finance state (EP-0035): accounts, transactions, forecasts list, and the loaded forecast
/// detail (snapshot + ledger + summary). Optimistic on success; errors surface via [error].
class FinanceProvider extends BaseProvider {
  final FinanceService _service;
  String? _householdId;

  List<Account> _accounts = [];
  List<FinanceTransaction> _transactions = [];
  List<ForecastListItem> _forecasts = [];
  ForecastDetail? _detail;

  FinanceProvider(this._service);

  List<Account> get accounts => List.unmodifiable(_accounts);
  List<FinanceTransaction> get transactions => List.unmodifiable(_transactions);
  List<ForecastListItem> get forecasts => List.unmodifiable(_forecasts);
  ForecastDetail? get detail => _detail;

  void bind(String householdId) {
    _householdId = householdId;
  }

  // --- accounts ---
  Future<void> loadAccounts() async {
    final h = _householdId;
    if (h == null) return;
    final r = await runGuarded(() => _service.listAccounts(h));
    if (r != null) {
      _accounts = r;
      notifyListeners();
    }
  }

  Future<bool> createAccount(Map<String, dynamic> body) async {
    final h = _householdId;
    if (h == null) return false;
    final r = await runGuarded(() => _service.createAccount(h, body));
    if (r == null) return false;
    await loadAccounts();
    return true;
  }

  Future<bool> updateAccount(String id, Map<String, dynamic> body) async {
    final h = _householdId;
    if (h == null) return false;
    final r = await runGuarded(() => _service.updateAccount(h, id, body));
    if (r == null) return false;
    _accounts = _accounts.map((a) => a.id == id ? r : a).toList();
    notifyListeners();
    return true;
  }

  Future<bool> deleteAccount(String id) async {
    final h = _householdId;
    if (h == null) return false;
    final ok = await runGuarded(() async {
      await _service.deleteAccount(h, id);
      return true;
    });
    if (ok != true) return false;
    _accounts = _accounts.where((a) => a.id != id).toList();
    notifyListeners();
    return true;
  }

  // --- transactions ---
  Future<void> loadTransactions() async {
    final h = _householdId;
    if (h == null) return;
    final r = await runGuarded(() => _service.listTransactions(h));
    if (r != null) {
      _transactions = r;
      notifyListeners();
    }
  }

  Future<bool> createTransaction(Map<String, dynamic> body) async {
    final h = _householdId;
    if (h == null) return false;
    final r = await runGuarded(() => _service.createTransaction(h, body));
    if (r == null) return false;
    await loadTransactions();
    return true;
  }

  Future<bool> updateTransaction(String id, Map<String, dynamic> body) async {
    final h = _householdId;
    if (h == null) return false;
    final r = await runGuarded(() => _service.updateTransaction(h, id, body));
    if (r == null) return false;
    _transactions = _transactions.map((t) => t.id == id ? r : t).toList();
    notifyListeners();
    return true;
  }

  Future<void> toggleIncluded(FinanceTransaction tx) async {
    final h = _householdId;
    if (h == null) return;
    final r = await runGuarded(() => _service.setIncluded(h, tx.id, !tx.forecastIncluded));
    if (r != null) {
      _transactions = _transactions.map((t) => t.id == r.id ? r : t).toList();
      notifyListeners();
    }
  }

  Future<bool> deleteTransaction(String id) async {
    final h = _householdId;
    if (h == null) return false;
    final ok = await runGuarded(() async {
      await _service.deleteTransaction(h, id);
      return true;
    });
    if (ok != true) return false;
    _transactions = _transactions.where((t) => t.id != id).toList();
    notifyListeners();
    return true;
  }

  // --- forecasts ---
  Future<void> loadForecasts() async {
    final h = _householdId;
    if (h == null) return;
    final r = await runGuarded(() => _service.listForecasts(h));
    if (r != null) {
      _forecasts = r;
      notifyListeners();
    }
  }

  /// Create a forecast; returns its id (or null on failure).
  Future<String?> createForecast(Map<String, dynamic> body) async {
    final h = _householdId;
    if (h == null) return null;
    final id = await runGuarded(() => _service.createForecast(h, body));
    if (id != null) await loadForecasts();
    return id;
  }

  Future<bool> deleteForecast(String id) async {
    final h = _householdId;
    if (h == null) return false;
    final ok = await runGuarded(() async {
      await _service.deleteForecast(h, id);
      return true;
    });
    if (ok != true) return false;
    _forecasts = _forecasts.where((f) => f.id != id).toList();
    notifyListeners();
    return true;
  }

  Future<void> loadDetail(String id) async {
    final h = _householdId;
    if (h == null) return;
    _detail = null;
    notifyListeners();
    final r = await runGuarded(() => _service.forecastDetail(h, id));
    if (r != null) {
      _detail = r;
      notifyListeners();
    }
  }
}
