import '../core/api/api_client.dart';
import '../models/budget.dart';

/// Transport for the household finance extensions API (EP-0036).
class BudgetService {
  final ApiClient _api;

  BudgetService(this._api);

  String _base(String h) => '/api/v1/households/$h';

  Future<List<Budget>> listBudgets(String h) => _api.getEnveloped('${_base(h)}/budgets', (r) {
        final list = (r as Map)['budgets'] as List;
        return list.map((e) => Budget.fromJson((e as Map).cast<String, dynamic>())).toList();
      });

  Future<Budget> createBudget(String h, Map<String, dynamic> body) => _api.postEnveloped(
        '${_base(h)}/budgets',
        body,
        (r) => Budget.fromJson(((r as Map)['budget'] as Map).cast<String, dynamic>()),
      );

  Future<void> deleteBudget(String h, String id) async {
    await _api.deleteEnveloped('${_base(h)}/budgets/$id', (_) => null);
  }

  Future<List<BudgetCategory>> categories(String h, String budgetId) =>
      _api.getEnveloped('${_base(h)}/budgets/$budgetId', (r) {
        final list = ((r as Map)['categories'] as List?) ?? const [];
        return list
            .map((e) => BudgetCategory.fromJson((e as Map).cast<String, dynamic>()))
            .toList();
      });

  Future<BudgetCategory> createCategory(String h, String budgetId, Map<String, dynamic> body) =>
      _api.postEnveloped(
        '${_base(h)}/budgets/$budgetId/categories',
        body,
        (r) => BudgetCategory.fromJson(((r as Map)['category'] as Map).cast<String, dynamic>()),
      );

  Future<void> deleteCategory(String h, String categoryId) async {
    await _api.deleteEnveloped('${_base(h)}/budget-categories/$categoryId', (_) => null);
  }

  Future<List<BudgetSummaryRow>> summary(String h, String budgetId) =>
      _api.getEnveloped('${_base(h)}/budgets/$budgetId/summary', (r) {
        final list = ((r as Map)['categories'] as List?) ?? const [];
        return list
            .map((e) => BudgetSummaryRow.fromJson((e as Map).cast<String, dynamic>()))
            .toList();
      });

  Future<List<Expense>> listExpenses(String h, {String? from, String? to, String? categoryId}) {
    final params = <String>[];
    if (from != null) params.add('from=$from');
    if (to != null) params.add('to=$to');
    if (categoryId != null) params.add('categoryId=$categoryId');
    final q = params.isEmpty ? '' : '?${params.join('&')}';
    return _api.getEnveloped('${_base(h)}/expenses$q', (r) {
      final list = (r as Map)['expenses'] as List;
      return list.map((e) => Expense.fromJson((e as Map).cast<String, dynamic>())).toList();
    });
  }

  Future<Expense> createExpense(String h, Map<String, dynamic> body) => _api.postEnveloped(
        '${_base(h)}/expenses',
        body,
        (r) => Expense.fromJson(((r as Map)['expense'] as Map).cast<String, dynamic>()),
      );

  Future<void> deleteExpense(String h, String id) async {
    await _api.deleteEnveloped('${_base(h)}/expenses/$id', (_) => null);
  }
}
