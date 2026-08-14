/**
 * Request validation for Centre Budgets, kept free of any database import so
 * the rules can be exercised as pure unit tests.
 */

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/;
/** NUMERIC(14,2): at most twelve integer digits and two decimal places. */
const DECIMAL_AMOUNT = /^-?\d{1,12}(\.\d{1,2})?$/;
const CURRENCY_CODE = /^[A-Z]{3}$/;
export const NOTE_MAX_LENGTH = 500;

export class CentreBudgetError extends Error {
  constructor(
    readonly code:
      | "access_denied"
      | "invalid_input"
      | "context_unavailable"
      | "centre_context_unavailable",
    options?: ErrorOptions,
  ) {
    super(`Centre Budgets unavailable: ${code}`, options);
    this.name = "CentreBudgetError";
  }
}

/**
 * Converts a `YYYY-MM` request value into the first-of-month key the database
 * stores.
 *
 * The calendar month is the grain this product slice was asked for. The
 * organisation's financial calendar — fiscal year start, period length, lock
 * and reconciliation status — remains an open decision in
 * BUDGET_ACCOUNTABILITY.md, so nothing here infers a fiscal period.
 */
export function parseMonthKey(month: unknown): string {
  if (typeof month !== "string") throw new CentreBudgetError("invalid_input");
  const match = MONTH_KEY.exec(month.trim());
  if (!match) throw new CentreBudgetError("invalid_input");
  const year = Number(match[1]);
  if (year < 2000 || year > 2100) throw new CentreBudgetError("invalid_input");
  return `${match[1]}-${match[2]}-01`;
}

/**
 * Validates a submitted amount without ever converting it to a number.
 *
 * `"0.00"` is valid and means a deliberate zero. An absent or empty value is
 * rejected outright rather than being quietly treated as zero, because those
 * are different statements about a centre's month.
 */
export function requireDecimalAmount(amount: unknown): string {
  if (typeof amount !== "string") throw new CentreBudgetError("invalid_input");
  const trimmed = amount.trim();
  if (!DECIMAL_AMOUNT.test(trimmed)) throw new CentreBudgetError("invalid_input");
  return trimmed;
}

export function requireCurrencyCode(currency: unknown): string {
  if (typeof currency !== "string") throw new CentreBudgetError("invalid_input");
  const trimmed = currency.trim();
  if (!CURRENCY_CODE.test(trimmed)) throw new CentreBudgetError("invalid_input");
  return trimmed;
}

export function requireUuid(value: unknown): string {
  if (typeof value !== "string" || !CANONICAL_UUID.test(value)) {
    throw new CentreBudgetError("invalid_input");
  }
  return value;
}

export function requireOptionalNote(note: unknown): string | undefined {
  if (note === undefined || note === null) return undefined;
  if (typeof note !== "string") throw new CentreBudgetError("invalid_input");
  const trimmed = note.trim();
  if (trimmed.length === 0 || trimmed.length > NOTE_MAX_LENGTH) {
    throw new CentreBudgetError("invalid_input");
  }
  return trimmed;
}
