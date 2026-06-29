import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gopher/core/api/api_client.dart';
import 'package:gopher/core/storage/in_memory_token_store.dart';
import 'package:gopher/providers/finance_provider.dart';
import 'package:gopher/screens/finance/forecast_detail_screen.dart';
import 'package:gopher/screens/finance/transactions_screen.dart';
import 'package:gopher/services/finance_service.dart';
import 'package:gopher/widgets/net_worth_chart.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';

String _env(Object? result) => jsonEncode({
      'version': 'v1',
      'statusCode': 200,
      'success': true,
      'message': 'OK',
      'result': result,
    });

ApiClient _client(MockClient mock) =>
    ApiClient(baseUrl: 'http://t', client: mock, tokenStore: InMemoryTokenStore());

Map<String, dynamic> _acct(String id, String name, String type) =>
    {'id': id, 'name': name, 'type': type, 'currentBalance': '100.00'};

Map<String, dynamic> _tx(String id, {bool included = true}) => {
      'id': id,
      'originAccountId': 'a1',
      'destinationAccountId': 'a2',
      'description': 'Rent',
      'category': 'Home',
      'transferType': 'FixedAmount',
      'transferAmount': '500.00',
      'startDate': '2026-01-01',
      'ending': 'Ongoing',
      'intervalUnit': 'Monthly',
      'frequency': 1,
      'forecastIncluded': included,
    };

void main() {
  group('FinanceProvider', () {
    test('createAccount posts then reloads', () async {
      var created = false;
      final mock = MockClient((req) async {
        final p = req.url.path;
        if (p.endsWith('/finance/accounts') && req.method == 'POST') {
          created = true;
          return http.Response(_env({'account': _acct('a1', 'Checking', 'Checking')}), 201);
        }
        if (p.endsWith('/finance/accounts')) {
          return http.Response(_env({'accounts': [_acct('a1', 'Checking', 'Checking')]}), 200);
        }
        return http.Response('{}', 404);
      });
      final provider = FinanceProvider(FinanceService(_client(mock)))..bind('h');
      final ok = await provider.createAccount({'name': 'Checking', 'type': 'Checking'});
      expect(ok, isTrue);
      expect(created, isTrue);
      expect(provider.accounts.length, 1);
    });

    test('toggleIncluded flips the flag in place', () async {
      final mock = MockClient((req) async {
        final p = req.url.path;
        if (p.contains('/transactions/t1/included') && req.method == 'PATCH') {
          return http.Response(_env({'transaction': _tx('t1', included: false)}), 200);
        }
        if (p.endsWith('/finance/transactions')) {
          return http.Response(_env({'transactions': [_tx('t1')]}), 200);
        }
        return http.Response('{}', 404);
      });
      final provider = FinanceProvider(FinanceService(_client(mock)))..bind('h');
      await provider.loadTransactions();
      expect(provider.transactions.first.forecastIncluded, isTrue);
      await provider.toggleIncluded(provider.transactions.first);
      expect(provider.transactions.first.forecastIncluded, isFalse);
    });

    test('createForecast returns the new id', () async {
      final mock = MockClient((req) async {
        final p = req.url.path;
        if (p.endsWith('/finance/forecasts') && req.method == 'POST') {
          return http.Response(_env({'forecast': {'id': 'f1'}}), 201);
        }
        if (p.endsWith('/finance/forecasts')) {
          return http.Response(_env({'forecasts': const []}), 200);
        }
        return http.Response('{}', 404);
      });
      final provider = FinanceProvider(FinanceService(_client(mock)))..bind('h');
      final id = await provider.createForecast(
        {'description': 'f', 'startDate': '2026-01-01', 'endDate': '2026-02-01'},
      );
      expect(id, 'f1');
    });
  });

  testWidgets('the transactions tab shows an included Switch and toggles it', (tester) async {
    final mock = MockClient((req) async {
      final p = req.url.path;
      if (p.contains('/transactions/t1/included') && req.method == 'PATCH') {
        return http.Response(_env({'transaction': _tx('t1', included: false)}), 200);
      }
      if (p.endsWith('/finance/transactions')) {
        return http.Response(_env({'transactions': [_tx('t1')]}), 200);
      }
      if (p.endsWith('/finance/accounts')) {
        return http.Response(
          _env({'accounts': [_acct('a1', 'Checking', 'Checking'), _acct('a2', 'Savings', 'Savings')]}),
          200,
        );
      }
      return http.Response('{}', 404);
    });
    final provider = FinanceProvider(FinanceService(_client(mock)))..bind('h');
    await provider.loadAccounts();
    await provider.loadTransactions();

    await tester.pumpWidget(
      MaterialApp(
        home: ChangeNotifierProvider<FinanceProvider>.value(
          value: provider,
          child: const TransactionsScreen(),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Rent'), findsOneWidget);
    final sw = tester.widget<Switch>(find.byType(Switch));
    expect(sw.value, isTrue);
    await tester.tap(find.byType(Switch));
    await tester.pumpAndSettle();
    expect(tester.widget<Switch>(find.byType(Switch)).value, isFalse);
  });

  testWidgets('the forecast detail renders five tabs and a net-worth chart', (tester) async {
    final mock = MockClient((req) async {
      final p = req.url.path;
      if (p.endsWith('/forecasts/f1/summary')) {
        return http.Response(
          _env({
            'summary': {
              'range': '2026-01-01 to 2026-01-03',
              'earned': 1500,
              'spent': 0,
              'saved': 0,
              'invested': 0,
              'creditLoanPayments': 100,
              'interest': 0,
              'startingCash': 1000,
              'endingCash': 2400,
              'startingCredit': -100,
              'endingCredit': 0,
              'startingNetWorth': 900,
              'endingNetWorth': 2400,
              'netWorthChange': 1500,
              'series': [
                {'date': '2026-01-01', 'netWorth': 1400},
                {'date': '2026-01-02', 'netWorth': 1900},
                {'date': '2026-01-03', 'netWorth': 2400},
              ],
            },
            'accountSummaries': const [],
            'transactionSummaries': const [],
            'categorySummaries': const [],
          }),
          200,
        );
      }
      if (p.endsWith('/forecasts/f1')) {
        return http.Response(
          _env({
            'forecast': {'id': 'f1', 'description': 'Jan', 'startDate': '2026-01-01', 'endDate': '2026-01-03'},
            'ledger': const [],
          }),
          200,
        );
      }
      return http.Response('{}', 404);
    });
    final provider = FinanceProvider(FinanceService(_client(mock)))..bind('h');
    await tester.pumpWidget(
      MaterialApp(
        home: ChangeNotifierProvider<FinanceProvider>.value(
          value: provider,
          child: const ForecastDetailScreen(forecastId: 'f1'),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Summary'), findsOneWidget);
    expect(find.text('Ledger'), findsOneWidget);
    expect(find.byType(NetWorthChart), findsOneWidget);
  });
}
