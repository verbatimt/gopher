import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../core/constants.dart';
import '../../models/budget.dart';
import '../../providers/auth_provider.dart';
import '../../providers/budget_provider.dart';
import '../../widgets/module_guard.dart';

/// Budgets & expenses home (EP-0036): a budget picker, per-category summary progress bars
/// (actual vs target), and entry points to add budgets/categories and the expense log.
class BudgetsScreen extends StatefulWidget {
  const BudgetsScreen({super.key});

  @override
  State<BudgetsScreen> createState() => _BudgetsScreenState();
}

class _BudgetsScreenState extends State<BudgetsScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final auth = context.read<AuthProvider>();
      final provider = context.read<BudgetProvider>();
      if (auth.householdId.isNotEmpty) {
        provider.bind(auth.householdId);
        provider.loadBudgets();
        provider.loadExpenses();
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<BudgetProvider>();
    return Scaffold(
      appBar: AppBar(
        title: const Text('Budgets'),
        actions: [
          IconButton(
            tooltip: 'Expenses',
            icon: const Icon(Icons.receipt_long_outlined),
            onPressed: () => context.push('/expenses'),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: provider.selectedBudgetId == null
            ? () => _newBudget(context)
            : () => _newCategory(context),
        icon: const Icon(Icons.add),
        label: Text(provider.selectedBudgetId == null ? 'Budget' : 'Category'),
      ),
      body: ModuleGuard(
        module: AppModules.finance,
        child: provider.budgets.isEmpty
            ? Center(
                child: FilledButton(
                  onPressed: () => _newBudget(context),
                  child: const Text('Create your first budget'),
                ),
              )
            : ListView(
                padding: const EdgeInsets.all(12),
                children: [
                  DropdownButtonFormField<String>(
                    initialValue: provider.selectedBudgetId,
                    decoration: const InputDecoration(labelText: 'Budget', border: OutlineInputBorder()),
                    items: [
                      for (final b in provider.budgets)
                        DropdownMenuItem(value: b.id, child: Text('${b.name} (${b.period})')),
                    ],
                    onChanged: (id) {
                      if (id != null) context.read<BudgetProvider>().selectBudget(id);
                    },
                  ),
                  const SizedBox(height: 12),
                  if (provider.summary.isEmpty)
                    const Padding(
                      padding: EdgeInsets.all(16),
                      child: Text('No categories yet — add one to track spending.'),
                    ),
                  for (final row in provider.summary) _categoryCard(context, row),
                ],
              ),
      ),
    );
  }

  Widget _categoryCard(BuildContext context, BudgetSummaryRow row) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(row.name, style: Theme.of(context).textTheme.titleMedium),
                Text('${row.actual.toStringAsFixed(2)} / ${row.target.toStringAsFixed(2)}'),
              ],
            ),
            const SizedBox(height: 8),
            LinearProgressIndicator(
              value: row.progress.clamp(0.0, 1.0),
              color: row.overBudget ? scheme.error : scheme.primary,
              backgroundColor: scheme.surfaceContainerHighest,
            ),
            const SizedBox(height: 4),
            Text(
              row.overBudget
                  ? 'Over by ${(-row.remaining).toStringAsFixed(2)}'
                  : '${row.remaining.toStringAsFixed(2)} remaining',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _newBudget(BuildContext context) async {
    final name = TextEditingController(text: 'Monthly budget');
    final start = TextEditingController(text: '2026-01-01');
    var period = 'monthly';
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setState) => AlertDialog(
          title: const Text('New budget'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(controller: name, decoration: const InputDecoration(labelText: 'Name')),
              DropdownButtonFormField<String>(
                initialValue: period,
                decoration: const InputDecoration(labelText: 'Period'),
                items: [for (final p in budgetPeriods) DropdownMenuItem(value: p, child: Text(p))],
                onChanged: (v) => setState(() => period = v ?? period),
              ),
              TextField(controller: start, decoration: const InputDecoration(labelText: 'Start (YYYY-MM-DD)')),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Create')),
          ],
        ),
      ),
    );
    if (ok != true || !context.mounted) return;
    await context.read<BudgetProvider>().createBudget({
      'name': name.text.trim(),
      'period': period,
      'startDate': start.text.trim(),
      if (period == 'custom') 'endDate': start.text.trim(),
    });
  }

  Future<void> _newCategory(BuildContext context) async {
    final name = TextEditingController();
    final target = TextEditingController(text: '0');
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('New category'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(controller: name, decoration: const InputDecoration(labelText: 'Name')),
            TextField(
              controller: target,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(labelText: 'Target amount'),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Add')),
        ],
      ),
    );
    if (ok != true || !context.mounted || name.text.trim().isEmpty) return;
    await context.read<BudgetProvider>().addCategory({
      'name': name.text.trim(),
      'targetAmount': double.tryParse(target.text.trim()) ?? 0,
    });
  }
}
