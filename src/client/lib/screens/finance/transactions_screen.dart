import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../models/finance.dart';
import '../../providers/finance_provider.dart';

/// Transactions list with create/edit/delete and an inline forecast-included toggle (EP-0035).
class TransactionsScreen extends StatelessWidget {
  const TransactionsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<FinanceProvider>();
    return Scaffold(
      floatingActionButton: FloatingActionButton.extended(
        onPressed: provider.accounts.length < 2
            ? null
            : () => _form(context, null, provider.accounts),
        icon: const Icon(Icons.add),
        label: const Text('Transaction'),
      ),
      body: provider.transactions.isEmpty
          ? const Center(child: Text('No transactions yet'))
          : ListView(
              children: [
                for (final t in provider.transactions)
                  ListTile(
                    title: Text(t.description),
                    subtitle: Text(
                      '${t.category} · ${t.transferType} ${t.transferAmount} · ${t.intervalUnit}',
                    ),
                    trailing: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Switch(
                          value: t.forecastIncluded,
                          onChanged: (_) =>
                              context.read<FinanceProvider>().toggleIncluded(t),
                        ),
                        IconButton(
                          tooltip: 'Delete',
                          icon: const Icon(Icons.delete_outline),
                          onPressed: () => context
                              .read<FinanceProvider>()
                              .deleteTransaction(t.id),
                        ),
                      ],
                    ),
                    onTap: () => _form(context, t, provider.accounts),
                  ),
              ],
            ),
    );
  }

  Future<void> _form(
    BuildContext context,
    FinanceTransaction? existing,
    List<Account> accounts,
  ) async {
    final desc = TextEditingController(text: existing?.description ?? '');
    final amount = TextEditingController(
      text: existing?.transferAmount.toString() ?? '0',
    );
    final startDate = TextEditingController(
      text: existing?.startDate ?? '2026-01-01',
    );
    var origin = existing?.originAccountId ?? accounts.first.id;
    var dest = existing?.destinationAccountId ?? accounts[1].id;
    var category = existing?.category ?? 'Misc';
    var transferType = existing?.transferType ?? 'FixedAmount';
    var ending = existing?.ending ?? 'Ongoing';
    var interval = existing?.intervalUnit ?? 'Monthly';

    final saved = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setState) => AlertDialog(
          title: Text(
            existing == null ? 'New transaction' : 'Edit transaction',
          ),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: desc,
                  decoration: const InputDecoration(labelText: 'Description'),
                ),
                _dropdown(
                  'From',
                  origin,
                  accounts.map((a) => (a.id, a.name)).toList(),
                  (v) => setState(() => origin = v),
                ),
                _dropdown(
                  'To',
                  dest,
                  accounts.map((a) => (a.id, a.name)).toList(),
                  (v) => setState(() => dest = v),
                ),
                _enumDropdown(
                  'Category',
                  category,
                  transactionCategories,
                  (v) => setState(() => category = v),
                ),
                _enumDropdown(
                  'Transfer type',
                  transferType,
                  transferTypes,
                  (v) => setState(() => transferType = v),
                ),
                TextField(
                  controller: amount,
                  keyboardType: const TextInputType.numberWithOptions(
                    decimal: true,
                  ),
                  decoration: const InputDecoration(labelText: 'Amount'),
                ),
                _enumDropdown(
                  'Interval',
                  interval,
                  recurrenceIntervals,
                  (v) => setState(() => interval = v),
                ),
                _enumDropdown(
                  'Ending',
                  ending,
                  transactionEndings,
                  (v) => setState(() => ending = v),
                ),
                TextField(
                  controller: startDate,
                  decoration: const InputDecoration(
                    labelText: 'Start date (YYYY-MM-DD)',
                  ),
                ),
              ],
            ),
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
    if (saved != true || !context.mounted) return;
    if (origin == dest) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Origin and destination must differ')),
      );
      return;
    }
    final body = <String, dynamic>{
      'originAccountId': origin,
      'destinationAccountId': dest,
      'description': desc.text.trim(),
      'category': category,
      'transferType': transferType,
      'transferAmount': double.tryParse(amount.text.trim()) ?? 0,
      'startDate': startDate.text.trim(),
      'ending': ending,
      'intervalUnit': interval,
    };
    final provider = context.read<FinanceProvider>();
    final ok = existing == null
        ? await provider.createTransaction(body)
        : await provider.updateTransaction(existing.id, body);
    if (!context.mounted) return;
    if (!ok) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(provider.error ?? 'Could not save the transaction'),
        ),
      );
    }
  }

  Widget _dropdown(
    String label,
    String value,
    List<(String, String)> options,
    void Function(String) onChanged,
  ) {
    return DropdownButtonFormField<String>(
      initialValue: value,
      decoration: InputDecoration(labelText: label),
      items: [
        for (final (id, name) in options)
          DropdownMenuItem(value: id, child: Text(name)),
      ],
      onChanged: (v) => onChanged(v ?? value),
    );
  }

  Widget _enumDropdown(
    String label,
    String value,
    List<String> options,
    void Function(String) onChanged,
  ) {
    return DropdownButtonFormField<String>(
      initialValue: value,
      decoration: InputDecoration(labelText: label),
      items: [
        for (final o in options) DropdownMenuItem(value: o, child: Text(o)),
      ],
      onChanged: (v) => onChanged(v ?? value),
    );
  }
}
