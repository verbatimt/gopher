import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/constants.dart';
import '../../providers/auth_provider.dart';
import '../../providers/finance_provider.dart';
import '../../widgets/module_guard.dart';
import 'accounts_screen.dart';
import 'forecasts_screen.dart';
import 'transactions_screen.dart';

/// Finance host (EP-0035): tabs for Accounts, Transactions, and Forecasts. Gated by the
/// `finance` module; the server denies SupervisedUser, and the nav is hidden for that role.
class FinanceScreen extends StatefulWidget {
  const FinanceScreen({super.key});

  @override
  State<FinanceScreen> createState() => _FinanceScreenState();
}

class _FinanceScreenState extends State<FinanceScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final auth = context.read<AuthProvider>();
      final provider = context.read<FinanceProvider>();
      if (auth.householdId.isNotEmpty) {
        provider.bind(auth.householdId);
        provider.loadAccounts();
        provider.loadTransactions();
        provider.loadForecasts();
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 3,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Finance'),
          bottom: const TabBar(
            tabs: [
              Tab(text: 'Accounts'),
              Tab(text: 'Transactions'),
              Tab(text: 'Forecasts'),
            ],
          ),
        ),
        body: const ModuleGuard(
          module: AppModules.finance,
          child: TabBarView(
            children: [AccountsScreen(), TransactionsScreen(), ForecastsScreen()],
          ),
        ),
      ),
    );
  }
}
