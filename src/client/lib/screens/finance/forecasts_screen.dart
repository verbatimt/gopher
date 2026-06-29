import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../providers/finance_provider.dart';

/// Forecasts list with a create flow (description, start, end) that generates a forecast and
/// navigates to its detail, plus delete (EP-0035).
class ForecastsScreen extends StatelessWidget {
  const ForecastsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<FinanceProvider>();
    return Scaffold(
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _create(context),
        icon: const Icon(Icons.add_chart),
        label: const Text('Forecast'),
      ),
      body: provider.forecasts.isEmpty
          ? const Center(child: Text('No forecasts yet'))
          : ListView(
              children: [
                for (final f in provider.forecasts)
                  ListTile(
                    leading: const Icon(Icons.show_chart),
                    title: Text(f.description),
                    subtitle: Text('${f.startDate} → ${f.endDate}'),
                    trailing: IconButton(
                      tooltip: 'Delete',
                      icon: const Icon(Icons.delete_outline),
                      onPressed: () =>
                          context.read<FinanceProvider>().deleteForecast(f.id),
                    ),
                    onTap: () => context.push('/finance/forecasts/${f.id}'),
                  ),
              ],
            ),
    );
  }

  Future<void> _create(BuildContext context) async {
    final desc = TextEditingController(text: 'Forecast');
    final start = TextEditingController(text: '2026-01-01');
    final end = TextEditingController(text: '2026-12-31');
    final go = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('New forecast'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: desc,
              decoration: const InputDecoration(labelText: 'Description'),
            ),
            TextField(
              controller: start,
              decoration: const InputDecoration(
                labelText: 'Start (YYYY-MM-DD)',
              ),
            ),
            TextField(
              controller: end,
              decoration: const InputDecoration(labelText: 'End (YYYY-MM-DD)'),
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
            child: const Text('Generate'),
          ),
        ],
      ),
    );
    if (go != true || !context.mounted) return;
    final provider = context.read<FinanceProvider>();
    final id = await provider.createForecast({
      'description': desc.text.trim(),
      'startDate': start.text.trim(),
      'endDate': end.text.trim(),
    });
    if (!context.mounted) return;
    if (id == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(provider.error ?? 'Could not generate the forecast'),
        ),
      );
      return;
    }
    context.push('/finance/forecasts/$id');
  }
}
