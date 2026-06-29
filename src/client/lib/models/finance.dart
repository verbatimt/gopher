// Finance & forecasting client models mirroring the EP-0032/0033/0034 API. Money fields are
// numeric(14,2) on the server (decimal strings); parsed to doubles for display.

const accountTypes = [
  'Checking',
  'Savings',
  'Credit',
  'Vendor',
  'Payroll',
  'Individual',
  'Investment',
  'Loan',
  'Interest',
];
const transactionCategories = [
  'Auto', 'Food', 'Holidays', 'Home', 'Medical', 'Misc', 'Pay', 'Personal', 'Pet', 'Services', //
  'Subscriptions', 'Taxes', 'Utilities', 'Vacation', 'Payment', 'Interest', 'Transfer', 'Savings',
  'Investment',
];
const transferTypes = ['FixedAmount', 'OriginPercentage', 'DestinationPercentage'];
const transactionEndings = ['Ongoing', 'OnDate', 'AfterOccurrences'];
const recurrenceIntervals = ['Once', 'Daily', 'Weekly', 'Monthly', 'Yearly'];

double _d(dynamic v) => v == null ? 0 : double.tryParse(v.toString()) ?? 0;

class Account {
  final String id;
  final String name;
  final String type;
  final String? notes;
  final double currentBalance;

  const Account({
    required this.id,
    required this.name,
    required this.type,
    this.notes,
    required this.currentBalance,
  });

  factory Account.fromJson(Map<String, dynamic> j) => Account(
        id: j['id'] as String,
        name: j['name'] as String? ?? '',
        type: j['type'] as String? ?? 'Checking',
        notes: j['notes'] as String?,
        currentBalance: _d(j['currentBalance']),
      );
}

class FinanceTransaction {
  final String id;
  final String originAccountId;
  final String destinationAccountId;
  final String description;
  final String category;
  final String transferType;
  final double transferAmount;
  final String startDate;
  final String ending;
  final String? endDate;
  final int? recurrenceCount;
  final String intervalUnit;
  final int frequency;
  final bool forecastIncluded;

  const FinanceTransaction({
    required this.id,
    required this.originAccountId,
    required this.destinationAccountId,
    required this.description,
    required this.category,
    required this.transferType,
    required this.transferAmount,
    required this.startDate,
    required this.ending,
    this.endDate,
    this.recurrenceCount,
    required this.intervalUnit,
    required this.frequency,
    required this.forecastIncluded,
  });

  factory FinanceTransaction.fromJson(Map<String, dynamic> j) => FinanceTransaction(
        id: j['id'] as String,
        originAccountId: j['originAccountId'] as String? ?? '',
        destinationAccountId: j['destinationAccountId'] as String? ?? '',
        description: j['description'] as String? ?? '',
        category: j['category'] as String? ?? 'Misc',
        transferType: j['transferType'] as String? ?? 'FixedAmount',
        transferAmount: _d(j['transferAmount']),
        startDate: j['startDate'] as String? ?? '',
        ending: j['ending'] as String? ?? 'Ongoing',
        endDate: j['endDate'] as String?,
        recurrenceCount: (j['recurrenceCount'] as num?)?.toInt(),
        intervalUnit: j['intervalUnit'] as String? ?? 'Monthly',
        frequency: (j['frequency'] as num?)?.toInt() ?? 1,
        forecastIncluded: j['forecastIncluded'] as bool? ?? true,
      );
}

class ForecastSummary {
  final String range;
  final double earned;
  final double spent;
  final double saved;
  final double invested;
  final double creditLoanPayments;
  final double interest;
  final double startingCash;
  final double endingCash;
  final double startingCredit;
  final double endingCredit;
  final double startingNetWorth;
  final double endingNetWorth;
  final double netWorthChange;
  final List<({String date, double netWorth})> series;
  final List<Map<String, dynamic>> accountSummaries;
  final List<Map<String, dynamic>> transactionSummaries;
  final List<Map<String, dynamic>> categorySummaries;

  const ForecastSummary({
    required this.range,
    required this.earned,
    required this.spent,
    required this.saved,
    required this.invested,
    required this.creditLoanPayments,
    required this.interest,
    required this.startingCash,
    required this.endingCash,
    required this.startingCredit,
    required this.endingCredit,
    required this.startingNetWorth,
    required this.endingNetWorth,
    required this.netWorthChange,
    required this.series,
    required this.accountSummaries,
    required this.transactionSummaries,
    required this.categorySummaries,
  });

  static List<Map<String, dynamic>> _rows(dynamic v) =>
      ((v as List?) ?? const []).map((e) => (e as Map).cast<String, dynamic>()).toList();

  factory ForecastSummary.fromJson(Map<String, dynamic> j) {
    final s = (j['summary'] as Map).cast<String, dynamic>();
    final series = ((s['series'] as List?) ?? const [])
        .map((e) => (e as Map).cast<String, dynamic>())
        .map((e) => (date: e['date'] as String? ?? '', netWorth: _d(e['netWorth'])))
        .toList();
    return ForecastSummary(
      range: s['range'] as String? ?? '',
      earned: _d(s['earned']),
      spent: _d(s['spent']),
      saved: _d(s['saved']),
      invested: _d(s['invested']),
      creditLoanPayments: _d(s['creditLoanPayments']),
      interest: _d(s['interest']),
      startingCash: _d(s['startingCash']),
      endingCash: _d(s['endingCash']),
      startingCredit: _d(s['startingCredit']),
      endingCredit: _d(s['endingCredit']),
      startingNetWorth: _d(s['startingNetWorth']),
      endingNetWorth: _d(s['endingNetWorth']),
      netWorthChange: _d(s['netWorthChange']),
      series: series,
      accountSummaries: _rows(j['accountSummaries']),
      transactionSummaries: _rows(j['transactionSummaries']),
      categorySummaries: _rows(j['categorySummaries']),
    );
  }
}

class ForecastListItem {
  final String id;
  final String description;
  final String startDate;
  final String endDate;

  const ForecastListItem({
    required this.id,
    required this.description,
    required this.startDate,
    required this.endDate,
  });

  factory ForecastListItem.fromJson(Map<String, dynamic> j) => ForecastListItem(
        id: j['id'] as String,
        description: j['description'] as String? ?? '',
        startDate: j['startDate'] as String? ?? '',
        endDate: j['endDate'] as String? ?? '',
      );
}

/// A forecast's read payload (snapshot + ledger) plus its computed summary.
class ForecastDetail {
  final ForecastListItem forecast;
  final List<Map<String, dynamic>> ledger;
  final ForecastSummary summary;

  const ForecastDetail({required this.forecast, required this.ledger, required this.summary});
}
