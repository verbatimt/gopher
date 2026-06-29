// Finance domain enums + derived groupings (EP-0032, Gopher's clean-slate design). Enum
// members are stored as their names in text columns guarded by CHECK constraints; the arrays
// here drive both the constraints and the engine/analytics groupings (EP-0033/0034). Adding a
// member is a migration, not a rewrite.

export const ACCOUNT_TYPES = [
  'Checking',
  'Savings',
  'Credit',
  'Vendor',
  'Payroll',
  'Individual',
  'Investment',
  'Loan',
  'Interest',
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const TRANSACTION_CATEGORIES = [
  'Auto',
  'Food',
  'Holidays',
  'Home',
  'Medical',
  'Misc',
  'Pay',
  'Personal',
  'Pet',
  'Services',
  'Subscriptions',
  'Taxes',
  'Utilities',
  'Vacation',
  'Payment',
  'Interest',
  'Transfer',
  'Savings',
  'Investment',
] as const;
export type TransactionCategory = (typeof TRANSACTION_CATEGORIES)[number];

export const TRANSFER_TYPES = ['FixedAmount', 'OriginPercentage', 'DestinationPercentage'] as const;
export type TransferType = (typeof TRANSFER_TYPES)[number];

export const TRANSACTION_ENDINGS = ['Ongoing', 'OnDate', 'AfterOccurrences'] as const;
export type TransactionEnding = (typeof TRANSACTION_ENDINGS)[number];

export const RECURRENCE_INTERVALS = ['Once', 'Daily', 'Weekly', 'Monthly', 'Yearly'] as const;
export type RecurrenceInterval = (typeof RECURRENCE_INTERVALS)[number];

// --- Derived groupings (engine + analytics share these) ---

/** Asset accounts: positive net-worth contributors. */
export const ASSET_TYPES: ReadonlySet<string> = new Set(['Checking', 'Savings', 'Investment']);
/** Liability accounts: balances are owed (held negative). */
export const LIABILITY_TYPES: ReadonlySet<string> = new Set(['Credit', 'Loan']);

export const isAsset = (type: string): boolean => ASSET_TYPES.has(type);
export const isLiability = (type: string): boolean => LIABILITY_TYPES.has(type);

/** Category → headline rollup group (EP-0034). */
export const CATEGORY_GROUPS: Record<string, readonly string[]> = {
  Earnings: ['Pay'],
  Spending: [
    'Auto',
    'Food',
    'Holidays',
    'Home',
    'Medical',
    'Misc',
    'Personal',
    'Pet',
    'Services',
    'Subscriptions',
    'Taxes',
    'Utilities',
    'Vacation',
  ],
  Savings: ['Savings', 'Transfer'],
  Investment: ['Investment'],
  CreditLoanPayments: ['Payment'],
  Interest: ['Interest'],
};

/** SQL fragment listing the quoted members of an enum (for CHECK constraints). */
export const sqlList = (members: readonly string[]): string =>
  members.map((m) => `'${m}'`).join(',');
