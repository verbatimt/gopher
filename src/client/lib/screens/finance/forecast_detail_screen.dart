import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../models/finance.dart';
import '../../providers/finance_provider.dart';
import '../../widgets/net_worth_chart.dart';

/// Forecast detail (EP-0035): five tabs — Summary (with net-worth chart), Accounts,
/// Transactions, Categories, Ledger — rendering the EP-0034 summaries + ledger.
class ForecastDetailScreen extends StatefulWidget {
  final String forecastId;

  const ForecastDetailScreen({super.key, required this.forecastId});

  @override
  State<ForecastDetailScreen> createState() => _ForecastDetailScreenState();
}

class _ForecastDetailScreenState extends State<ForecastDetailScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback(
      (_) => context.read<FinanceProvider>().loadDetail(widget.forecastId),
    );
  }

  @override
  Widget build(BuildContext context) {
    final detail = context.watch<FinanceProvider>().detail;
    return DefaultTabController(
      length: 5,
      child: Scaffold(
        appBar: AppBar(
          title: Text(detail?.forecast.description ?? 'Forecast'),
          bottom: const TabBar(
            isScrollable: true,
            tabs: [
              Tab(text: 'Summary'),
              Tab(text: 'Accounts'),
              Tab(text: 'Transactions'),
              Tab(text: 'Categories'),
              Tab(text: 'Ledger'),
            ],
          ),
        ),
        body: detail == null
            ? const Center(child: CircularProgressIndicator())
            : TabBarView(
                children: [
                  _summaryTab(detail.summary),
                  _metricsTab(detail.summary.accountSummaries, 'accountName'),
                  _metricsTab(detail.summary.transactionSummaries, 'key'),
                  _metricsTab(detail.summary.categorySummaries, 'key'),
                  _ledgerTab(detail.ledger),
                ],
              ),
      ),
    );
  }

  Widget _summaryTab(ForecastSummary s) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text('Net worth over time', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        NetWorthChart(values: s.series.map((p) => p.netWorth).toList()),
        const SizedBox(height: 16),
        _kv('Range', s.range),
        _kv('Earned', s.earned.toStringAsFixed(2)),
        _kv('Spent', s.spent.toStringAsFixed(2)),
        _kv('Saved', s.saved.toStringAsFixed(2)),
        _kv('Invested', s.invested.toStringAsFixed(2)),
        _kv('Credit/Loan payments', s.creditLoanPayments.toStringAsFixed(2)),
        _kv('Interest', s.interest.toStringAsFixed(2)),
        const Divider(),
        _kv('Cash (start → end)', '${s.startingCash.toStringAsFixed(2)} → ${s.endingCash.toStringAsFixed(2)}'),
        _kv('Credit (start → end)', '${s.startingCredit.toStringAsFixed(2)} → ${s.endingCredit.toStringAsFixed(2)}'),
        _kv('Net worth (start → end)', '${s.startingNetWorth.toStringAsFixed(2)} → ${s.endingNetWorth.toStringAsFixed(2)}'),
        _kv('Net worth change', s.netWorthChange.toStringAsFixed(2)),
      ],
    );
  }

  Widget _metricsTab(List<Map<String, dynamic>> rows, String labelKey) {
    if (rows.isEmpty) return const Center(child: Text('No data'));
    return ListView(
      children: [
        for (final r in rows)
          ListTile(
            dense: true,
            title: Text('${r[labelKey] ?? r['key'] ?? ''}'),
            subtitle: Text(
              'credit ${r['credit']} · debit ${r['debit']} · open ${r['opening']} · close ${r['closing']}',
            ),
            trailing: Text('${r['count']}'),
          ),
      ],
    );
  }

  Widget _ledgerTab(List<Map<String, dynamic>> ledger) {
    if (ledger.isEmpty) return const Center(child: Text('No ledger entries'));
    return ListView(
      children: [
        for (final e in ledger)
          ListTile(
            dense: true,
            leading: Icon((e['origin'] as bool? ?? false) ? Icons.remove : Icons.add,
                color: (e['origin'] as bool? ?? false) ? Colors.red : Colors.green),
            title: Text('${e['name']} · ${e['amount']}'),
            subtitle: Text('${e['date']} · ${e['category']} · ${e['description']}'),
          ),
      ],
    );
  }

  Widget _kv(String k, String v) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(k, style: Theme.of(context).textTheme.bodyMedium),
            Text(v, style: Theme.of(context).textTheme.bodyMedium),
          ],
        ),
      );
}
