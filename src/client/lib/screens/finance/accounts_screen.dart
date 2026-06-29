import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../models/finance.dart';
import '../../providers/finance_provider.dart';

/// Accounts list with create/edit/delete (EP-0035). Used as the Accounts tab of FinanceScreen.
class AccountsScreen extends StatelessWidget {
  const AccountsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<FinanceProvider>();
    return Scaffold(
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _form(context, null),
        icon: const Icon(Icons.add),
        label: const Text('Account'),
      ),
      body: provider.accounts.isEmpty
          ? const Center(child: Text('No accounts yet'))
          : ListView(
              children: [
                for (final a in provider.accounts)
                  ListTile(
                    leading: const Icon(Icons.account_balance_outlined),
                    title: Text(a.name),
                    subtitle: Text(
                      '${a.type} · ${a.currentBalance.toStringAsFixed(2)}',
                    ),
                    trailing: IconButton(
                      tooltip: 'Delete',
                      icon: const Icon(Icons.delete_outline),
                      onPressed: () =>
                          context.read<FinanceProvider>().deleteAccount(a.id),
                    ),
                    onTap: () => _form(context, a),
                  ),
              ],
            ),
    );
  }

  Future<void> _form(BuildContext context, Account? existing) async {
    final name = TextEditingController(text: existing?.name ?? '');
    final balance = TextEditingController(
      text: existing?.currentBalance.toStringAsFixed(2) ?? '0',
    );
    final notes = TextEditingController(text: existing?.notes ?? '');
    var type = existing?.type ?? accountTypes.first;

    final saved = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setState) => AlertDialog(
          title: Text(existing == null ? 'New account' : 'Edit account'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: name,
                  decoration: const InputDecoration(labelText: 'Name'),
                ),
                DropdownButtonFormField<String>(
                  initialValue: type,
                  decoration: const InputDecoration(labelText: 'Type'),
                  items: [
                    for (final t in accountTypes)
                      DropdownMenuItem(value: t, child: Text(t)),
                  ],
                  onChanged: (v) => setState(() => type = v ?? type),
                ),
                TextField(
                  controller: balance,
                  keyboardType: const TextInputType.numberWithOptions(
                    decimal: true,
                    signed: true,
                  ),
                  decoration: const InputDecoration(
                    labelText: 'Current balance',
                  ),
                ),
                TextField(
                  controller: notes,
                  decoration: const InputDecoration(
                    labelText: 'Notes (optional)',
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
    if (name.text.trim().isEmpty) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Name is required')));
      return;
    }
    final body = <String, dynamic>{
      'name': name.text.trim(),
      'type': type,
      'currentBalance': double.tryParse(balance.text.trim()) ?? 0,
      'notes': notes.text.trim(),
    };
    final provider = context.read<FinanceProvider>();
    final ok = existing == null
        ? await provider.createAccount(body)
        : await provider.updateAccount(existing.id, body);
    if (!context.mounted) return;
    if (!ok) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(provider.error ?? 'Could not save the account')),
      );
    }
  }
}
