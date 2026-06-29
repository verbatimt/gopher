import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/constants.dart';
import '../../providers/auth_provider.dart';
import '../../providers/budget_provider.dart';
import '../../widgets/module_guard.dart';

/// Expense log (EP-0036): list logged expenses, add a new one (optionally categorized), delete.
class ExpensesScreen extends StatefulWidget {
  const ExpensesScreen({super.key});

  @override
  State<ExpensesScreen> createState() => _ExpensesScreenState();
}

class _ExpensesScreenState extends State<ExpensesScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final auth = context.read<AuthProvider>();
      final provider = context.read<BudgetProvider>();
      if (auth.householdId.isNotEmpty) {
        provider.bind(auth.householdId);
        provider.loadExpenses();
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<BudgetProvider>();
    return Scaffold(
      appBar: AppBar(title: const Text('Expenses')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _newExpense(context),
        icon: const Icon(Icons.add),
        label: const Text('Expense'),
      ),
      body: ModuleGuard(
        module: AppModules.finance,
        child: provider.expenses.isEmpty
            ? const Center(child: Text('No expenses logged'))
            : ListView(
                children: [
                  for (final e in provider.expenses)
                    ListTile(
                      leading: const Icon(Icons.payments_outlined),
                      title: Text(
                        '${e.amount.toStringAsFixed(2)} ${e.currencyCode}',
                      ),
                      subtitle: Text(
                        '${e.expenseDate}${e.description != null ? ' · ${e.description}' : ''}',
                      ),
                      trailing: IconButton(
                        tooltip: 'Delete',
                        icon: const Icon(Icons.delete_outline),
                        onPressed: () =>
                            context.read<BudgetProvider>().deleteExpense(e.id),
                      ),
                    ),
                ],
              ),
      ),
    );
  }

  Future<void> _newExpense(BuildContext context) async {
    final amount = TextEditingController();
    final date = TextEditingController(text: '2026-01-01');
    final desc = TextEditingController();
    final categories = context.read<BudgetProvider>().categories;
    String? categoryId;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setState) => AlertDialog(
          title: const Text('Log expense'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: amount,
                keyboardType: const TextInputType.numberWithOptions(
                  decimal: true,
                ),
                decoration: const InputDecoration(labelText: 'Amount'),
              ),
              TextField(
                controller: date,
                decoration: const InputDecoration(
                  labelText: 'Date (YYYY-MM-DD)',
                ),
              ),
              TextField(
                controller: desc,
                decoration: const InputDecoration(
                  labelText: 'Description (optional)',
                ),
              ),
              if (categories.isNotEmpty)
                DropdownButtonFormField<String>(
                  initialValue: categoryId,
                  decoration: const InputDecoration(
                    labelText: 'Category (optional)',
                  ),
                  items: [
                    const DropdownMenuItem(
                      value: null,
                      child: Text('Uncategorized'),
                    ),
                    for (final c in categories)
                      DropdownMenuItem(value: c.id, child: Text(c.name)),
                  ],
                  onChanged: (v) => setState(() => categoryId = v),
                ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Save'),
            ),
          ],
        ),
      ),
    );
    if (ok != true || !context.mounted) return;
    final value = double.tryParse(amount.text.trim());
    if (value == null || value <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('A positive amount is required')),
      );
      return;
    }
    final provider = context.read<BudgetProvider>();
    final added = await provider.addExpense({
      'amount': value,
      'expenseDate': date.text.trim(),
      if (desc.text.trim().isNotEmpty) 'description': desc.text.trim(),
      'categoryId': ?categoryId,
    });
    if (context.mounted && !added) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(provider.error ?? 'Could not log the expense')),
      );
    }
  }
}
