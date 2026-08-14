/**
 * Value handling for Centre Budgets.
 *
 * Money and percentages arrive from the API as exact decimal strings, because
 * PostgreSQL holds them as `NUMERIC(14,2)` and `NUMERIC(7,2)` and the contract
 * says plainly that a JSON number would be parsed into an IEEE-754 double by
 * every JavaScript client. Nothing in this file calls `Number`, `parseFloat`,
 * `parseInt` or `toFixed` on a monetary value: every figure is formatted, and
 * every comparison is made, on the digits themselves.
 *
 * That is not pedantry about rounding alone. `Number("0.00")` is `0`, and
 * `String(0)` is `"0"`, so a single round-trip through a number silently erases
 * the difference between a recorded zero and a bare zero — and, one step
 * further, between a recorded zero and nothing recorded at all. Keeping the
 * string intact keeps those three states distinguishable.
 */

/**
 * The shape the API sends: an optional sign, at least one digit, and an
 * optional fractional part. Grouping separators are never accepted, because
 * they never appear on the wire.
 */
const EXACT_DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

/**
 * What a Centre Director may type. This mirrors the backend's own
 * `DECIMAL_AMOUNT` rule exactly — at most twelve integer digits and two
 * decimal places — so the browser rejects what the API would reject, rather
 * than inventing a narrower or wider rule of its own.
 */
const ENTERABLE_AMOUNT = /^-?\d{1,12}(\.\d{1,2})?$/;

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface ExactDecimal {
  readonly negative: boolean;
  /** Digits before the point, exactly as sent. */
  readonly whole: string;
  /** Digits after the point, padded to at least two places, never truncated. */
  readonly fraction: string;
}

/** Splits a decimal string into digits. Returns `undefined` if it is not one. */
export function parseExactDecimal(value: string): ExactDecimal | undefined {
  const match = EXACT_DECIMAL.exec(value.trim());
  if (!match) return undefined;
  return {
    negative: match[1] === "-",
    whole: match[2],
    fraction: (match[3] ?? "").padEnd(2, "0"),
  };
}

function isZero(parts: ExactDecimal): boolean {
  return /^0*$/u.test(parts.whole) && /^0*$/u.test(parts.fraction);
}

/** Inserts thousands separators by walking the digits from the right. */
function group(whole: string): string {
  let grouped = "";
  for (let end = whole.length; end > 0; end -= 3) {
    const start = Math.max(0, end - 3);
    grouped = whole.slice(start, end) + (grouped ? `,${grouped}` : "");
  }
  return grouped || "0";
}

function render(parts: ExactDecimal): string {
  const sign = parts.negative && !isZero(parts) ? "-" : "";
  return `${sign}${group(parts.whole)}.${parts.fraction}`;
}

/**
 * Formats a decimal string for display, preserving every digit that was sent.
 *
 * A value this cannot parse is returned unchanged rather than replaced with a
 * zero or a dash: showing the reader the figure the API actually sent is
 * honest, and inventing one is not.
 */
export function formatAmount(value: string): string {
  const parts = parseExactDecimal(value);
  return parts ? render(parts) : value.trim();
}

/**
 * Formats an amount with the currency the API supplied.
 *
 * No symbol, locale or minor-unit rule is applied, and none is assumed: the
 * organisation's reporting currency is an open owner decision, so the only
 * honest thing to render is the code the record itself carries. Where a record
 * carries no code, the figure is rendered plainly rather than dressed in a
 * currency nobody has approved.
 */
export function formatMoney(value: string, currency?: string): string {
  const figure = formatAmount(value);
  return currency ? `${currency} ${figure}` : figure;
}

export function formatPercent(value: string): string {
  return `${formatAmount(value)}%`;
}

/** True only for a value that is both signed and non-zero, so `-0.00` is not. */
export function isNegativeAmount(value: string): boolean {
  const parts = parseExactDecimal(value);
  return parts !== undefined && parts.negative && !isZero(parts);
}

/**
 * Orders two decimal strings exactly, without ever making them numbers.
 *
 * Magnitudes are compared by digit count first and then character by character,
 * which is exact for arbitrary precision. Used only to rank centres for
 * attention — never to derive a figure that is then displayed.
 */
export function compareExactDecimals(left: string, right: string): number {
  const a = parseExactDecimal(left);
  const b = parseExactDecimal(right);
  if (!a || !b) return 0;

  const aNegative = a.negative && !isZero(a);
  const bNegative = b.negative && !isZero(b);
  if (aNegative !== bNegative) return aNegative ? -1 : 1;

  const width = Math.max(a.fraction.length, b.fraction.length);
  const aDigits = a.whole.replace(/^0+(?=\d)/u, "") + a.fraction.padEnd(width, "0");
  const bDigits = b.whole.replace(/^0+(?=\d)/u, "") + b.fraction.padEnd(width, "0");

  let magnitude = 0;
  if (aDigits.length !== bDigits.length) {
    magnitude = aDigits.length > bDigits.length ? 1 : -1;
  } else if (aDigits !== bDigits) {
    magnitude = aDigits > bDigits ? 1 : -1;
  }

  return aNegative ? -magnitude : magnitude;
}

/** Whether a typed amount is one the API will accept. */
export function isEnterableAmount(value: string): boolean {
  return ENTERABLE_AMOUNT.test(value.trim());
}

/* ------------------------------------------------------------------ *
 * Calendar months
 *
 * The grain is the calendar month, which is what this slice was built for.
 * The organisation's financial calendar — fiscal year start, period length,
 * lock and reconciliation status — is an open decision, so nothing here
 * infers a fiscal period or claims one exists.
 * ------------------------------------------------------------------ */

export function isMonthKey(value: string): boolean {
  return MONTH_KEY.test(value);
}

/**
 * The month the reader is currently in, from their own device clock.
 *
 * The budget contract carries no organisation timezone, so this is the only
 * month this surface can open on without inventing one. The month is always
 * shown in writing, so a reader in another timezone can see which one they
 * were given and step to the one they meant.
 */
export function currentMonthKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function shiftMonth(month: string, delta: number): string {
  const [year, index] = month.split("-");
  const zeroBased = Number(year) * 12 + (Number(index) - 1) + delta;
  const shiftedYear = Math.floor(zeroBased / 12);
  const shiftedMonth = zeroBased - shiftedYear * 12 + 1;
  return `${String(shiftedYear).padStart(4, "0")}-${String(shiftedMonth).padStart(2, "0")}`;
}

export function formatMonthLabel(month: string): string {
  if (!isMonthKey(month)) return month;
  const [year, index] = month.split("-");
  return new Intl.DateTimeFormat("en-AU", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(Number(year), Number(index) - 1, 1)));
}
