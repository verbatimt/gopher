// Household budgeting/expense models mirroring the EP-0036 API. Money is numeric(12,2) on the
// server (decimal strings); parsed to doubles for display.

double _d(dynamic v) => v == null ? 0 : double.tryParse(v.toString()) ?? 0;

const budgetPeriods = ['weekly', 'monthly', 'annual', 'custom'];

class Budget {
  final String id;
  final String name;
  final String period;
  final String startDate;
  final String? endDate;

  const Budget({
    required this.id,
    required this.name,
    required this.period,
    required this.startDate,
    this.endDate,
  });

  factory Budget.fromJson(Map<String, dynamic> j) => Budget(
        id: j['id'] as String,
        name: j['name'] as String? ?? '',
        period: j['period'] as String? ?? 'monthly',
        startDate: j['startDate'] as String? ?? '',
        endDate: j['endDate'] as String?,
      );
}

class BudgetCategory {
  final String id;
  final String name;
  final double targetAmount;
  final String? colorTag;

  const BudgetCategory({
    required this.id,
    required this.name,
    required this.targetAmount,
    this.colorTag,
  });

  factory BudgetCategory.fromJson(Map<String, dynamic> j) => BudgetCategory(
        id: j['id'] as String,
        name: j['name'] as String? ?? '',
        targetAmount: _d(j['targetAmount']),
        colorTag: j['colorTag'] as String?,
      );
}

/// One row of a budget summary: actual spend vs target for a category.
class BudgetSummaryRow {
  final String categoryId;
  final String name;
  final double target;
  final double actual;
  final double remaining;

  const BudgetSummaryRow({
    required this.categoryId,
    required this.name,
    required this.target,
    required this.actual,
    required this.remaining,
  });

  /// Fraction spent (0..1+), guarded against a zero target.
  double get progress => target <= 0 ? (actual > 0 ? 1 : 0) : (actual / target);
  bool get overBudget => actual > target;

  factory BudgetSummaryRow.fromJson(Map<String, dynamic> j) => BudgetSummaryRow(
        categoryId: j['categoryId'] as String? ?? '',
        name: j['name'] as String? ?? '',
        target: _d(j['target']),
        actual: _d(j['actual']),
        remaining: _d(j['remaining']),
      );
}

class Expense {
  final String id;
  final String? categoryId;
  final double amount;
  final String currencyCode;
  final String expenseDate;
  final String? description;

  const Expense({
    required this.id,
    this.categoryId,
    required this.amount,
    required this.currencyCode,
    required this.expenseDate,
    this.description,
  });

  factory Expense.fromJson(Map<String, dynamic> j) => Expense(
        id: j['id'] as String,
        categoryId: j['categoryId'] as String?,
        amount: _d(j['amount']),
        currencyCode: j['currencyCode'] as String? ?? 'USD',
        expenseDate: j['expenseDate'] as String? ?? '',
        description: j['description'] as String?,
      );
}
