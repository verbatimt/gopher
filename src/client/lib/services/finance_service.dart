import '../core/api/api_client.dart';
import '../models/finance.dart';

/// Transport for the finance engine API (EP-0033/0034).
class FinanceService {
  final ApiClient _api;

  FinanceService(this._api);

  String _base(String h) => '/api/v1/households/$h/finance';

  // --- accounts ---
  Future<List<Account>> listAccounts(String h) =>
      _api.getEnveloped('${_base(h)}/accounts', (r) {
        final list = (r as Map)['accounts'] as List;
        return list.map((e) => Account.fromJson((e as Map).cast<String, dynamic>())).toList();
      });

  Future<Account> createAccount(String h, Map<String, dynamic> body) => _api.postEnveloped(
        '${_base(h)}/accounts',
        body,
        (r) => Account.fromJson(((r as Map)['account'] as Map).cast<String, dynamic>()),
      );

  Future<Account> updateAccount(String h, String id, Map<String, dynamic> body) =>
      _api.patchEnveloped(
        '${_base(h)}/accounts/$id',
        body,
        (r) => Account.fromJson(((r as Map)['account'] as Map).cast<String, dynamic>()),
      );

  Future<void> deleteAccount(String h, String id) async {
    await _api.deleteEnveloped('${_base(h)}/accounts/$id', (_) => null);
  }

  // --- transactions ---
  Future<List<FinanceTransaction>> listTransactions(String h) =>
      _api.getEnveloped('${_base(h)}/transactions', (r) {
        final list = (r as Map)['transactions'] as List;
        return list
            .map((e) => FinanceTransaction.fromJson((e as Map).cast<String, dynamic>()))
            .toList();
      });

  Future<FinanceTransaction> createTransaction(String h, Map<String, dynamic> body) =>
      _api.postEnveloped(
        '${_base(h)}/transactions',
        body,
        (r) =>
            FinanceTransaction.fromJson(((r as Map)['transaction'] as Map).cast<String, dynamic>()),
      );

  Future<FinanceTransaction> updateTransaction(String h, String id, Map<String, dynamic> body) =>
      _api.patchEnveloped(
        '${_base(h)}/transactions/$id',
        body,
        (r) =>
            FinanceTransaction.fromJson(((r as Map)['transaction'] as Map).cast<String, dynamic>()),
      );

  Future<FinanceTransaction> setIncluded(String h, String id, bool included) =>
      _api.patchEnveloped(
        '${_base(h)}/transactions/$id/included',
        {'included': included},
        (r) =>
            FinanceTransaction.fromJson(((r as Map)['transaction'] as Map).cast<String, dynamic>()),
      );

  Future<void> deleteTransaction(String h, String id) async {
    await _api.deleteEnveloped('${_base(h)}/transactions/$id', (_) => null);
  }

  // --- forecasts ---
  Future<List<ForecastListItem>> listForecasts(String h) =>
      _api.getEnveloped('${_base(h)}/forecasts', (r) {
        final list = (r as Map)['forecasts'] as List;
        return list
            .map((e) => ForecastListItem.fromJson((e as Map).cast<String, dynamic>()))
            .toList();
      });

  Future<String> createForecast(String h, Map<String, dynamic> body) => _api.postEnveloped(
        '${_base(h)}/forecasts',
        body,
        (r) => ((r as Map)['forecast'] as Map)['id'] as String,
      );

  Future<void> deleteForecast(String h, String id) async {
    await _api.deleteEnveloped('${_base(h)}/forecasts/$id', (_) => null);
  }

  Future<ForecastDetail> forecastDetail(String h, String id) async {
    final read = await _api.getEnveloped('${_base(h)}/forecasts/$id', (r) => r);
    final summaryJson = await _api.getEnveloped('${_base(h)}/forecasts/$id/summary', (r) => r);
    final m = (read as Map).cast<String, dynamic>();
    final ledger = ((m['ledger'] as List?) ?? const [])
        .map((e) => (e as Map).cast<String, dynamic>())
        .toList();
    return ForecastDetail(
      forecast: ForecastListItem.fromJson((m['forecast'] as Map).cast<String, dynamic>()),
      ledger: ledger,
      summary: ForecastSummary.fromJson((summaryJson as Map).cast<String, dynamic>()),
    );
  }
}
