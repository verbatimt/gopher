// Finance module error catalog (EP-0033). FinanceError maps to a 422 envelope via the central
// handler; every rejection carries a clear, user-facing message (never a partial save).

import { AppError } from '../../http/errors.ts';

export const FINANCE_MESSAGES = {
  no_active_accounts: 'There are no active accounts to forecast.',
  no_active_transactions: 'No active transactions are included in the forecast.',
  duplicate_account_name: 'An active account with that name already exists.',
  account_name_required: 'An account name is required.',
  same_account: 'The origin and destination accounts must be different.',
  unknown_account: 'The origin and destination must reference existing accounts.',
  description_required: 'A description is required.',
  transfer_amount_zero: 'The transfer amount must not be zero.',
  start_date_too_old: 'The start date is too far in the past.',
  end_before_start: 'The end date must be after the start date.',
  recurrence_count_invalid: 'A recurrence count of at least 1 is required.',
  frequency_invalid: 'The frequency must be at least 1.',
  forecast_end_before_start: 'The forecast end date must be after its start date.',
} as const;

export type FinanceErrorCode = keyof typeof FINANCE_MESSAGES;

export class FinanceError extends AppError {
  readonly code: FinanceErrorCode;

  constructor(code: FinanceErrorCode) {
    super('Invalid', FINANCE_MESSAGES[code]);
    this.code = code;
  }
}
