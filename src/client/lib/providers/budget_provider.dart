import '../models/budget.dart';
import '../services/budget_service.dart';
import 'base_provider.dart';

/// Household budgeting/expense state (EP-0036): budgets, the selected budget's summary +
/// categories, and the expense log.
class BudgetProvider extends BaseProvider {
  final BudgetService _service;
  String? _householdId;

  List<Budget> _budgets = [];
  String? _selectedBudgetId;
  List<BudgetSummaryRow> _summary = [];
  List<BudgetCategory> _categories = [];
  List<Expense> _expenses = [];

  BudgetProvider(this._service);

  List<Budget> get budgets => List.unmodifiable(_budgets);
  String? get selectedBudgetId => _selectedBudgetId;
  List<BudgetSummaryRow> get summary => List.unmodifiable(_summary);
  List<BudgetCategory> get categories => List.unmodifiable(_categories);
  List<Expense> get expenses => List.unmodifiable(_expenses);

  void bind(String householdId) => _householdId = householdId;

  Future<void> loadBudgets() async {
    final h = _householdId;
    if (h == null) return;
    final r = await runGuarded(() => _service.listBudgets(h));
    if (r != null) {
      _budgets = r;
      notifyListeners();
      if (_selectedBudgetId == null && r.isNotEmpty) await selectBudget(r.first.id);
    }
  }

  Future<bool> createBudget(Map<String, dynamic> body) async {
    final h = _householdId;
    if (h == null) return false;
    final r = await runGuarded(() => _service.createBudget(h, body));
    if (r == null) return false;
    await loadBudgets();
    await selectBudget(r.id);
    return true;
  }

  Future<void> selectBudget(String budgetId) async {
    final h = _householdId;
    if (h == null) return;
    _selectedBudgetId = budgetId;
    await runGuarded(() async {
      _categories = await _service.categories(h, budgetId);
      _summary = await _service.summary(h, budgetId);
    });
    notifyListeners();
  }

  Future<bool> addCategory(Map<String, dynamic> body) async {
    final h = _householdId;
    final budgetId = _selectedBudgetId;
    if (h == null || budgetId == null) return false;
    final r = await runGuarded(() => _service.createCategory(h, budgetId, body));
    if (r == null) return false;
    await selectBudget(budgetId);
    return true;
  }

  Future<void> loadExpenses() async {
    final h = _householdId;
    if (h == null) return;
    final r = await runGuarded(() => _service.listExpenses(h));
    if (r != null) {
      _expenses = r;
      notifyListeners();
    }
  }

  Future<bool> addExpense(Map<String, dynamic> body) async {
    final h = _householdId;
    if (h == null) return false;
    final r = await runGuarded(() => _service.createExpense(h, body));
    if (r == null) return false;
    await loadExpenses();
    if (_selectedBudgetId != null) await selectBudget(_selectedBudgetId!);
    return true;
  }

  Future<void> deleteExpense(String id) async {
    final h = _householdId;
    if (h == null) return;
    final ok = await runGuarded(() async {
      await _service.deleteExpense(h, id);
      return true;
    });
    if (ok == true) {
      _expenses = _expenses.where((e) => e.id != id).toList();
      notifyListeners();
    }
  }
}
