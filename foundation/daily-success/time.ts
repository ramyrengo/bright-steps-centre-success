import type {
  DailyBusinessDateContext,
  DailyDueInformation,
} from "./contracts";

export class DailySuccessTimezoneError extends Error {
  constructor() {
    super("Daily Success timezone is unavailable");
    this.name = "DailySuccessTimezoneError";
  }
}

interface LocalDateParts {
  year: number;
  month: number;
  day: number;
}

function validateTimezoneShape(timezone: string): void {
  if (
    timezone.length > 100 ||
    !(timezone === "UTC" || /^[A-Za-z_+\-]+(?:\/[A-Za-z0-9_+\-]+)+$/.test(timezone))
  ) {
    throw new DailySuccessTimezoneError();
  }
}

export function requireIanaTimezone(timezone: string): string {
  validateTimezoneShape(timezone);
  try {
    const resolved = new Intl.DateTimeFormat("en-AU", { timeZone: timezone })
      .resolvedOptions().timeZone;
    if (!resolved) {
      throw new DailySuccessTimezoneError();
    }
    return timezone;
  } catch {
    throw new DailySuccessTimezoneError();
  }
}

function localDateParts(at: Date, timezone: string): LocalDateParts {
  requireIanaTimezone(timezone);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const value = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type)?.value;
    if (!part) throw new DailySuccessTimezoneError();
    return Number(part);
  };
  return { year: value("year"), month: value("month"), day: value("day") };
}

function dateKey(parts: LocalDateParts): string {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function calendarOrdinal(parts: LocalDateParts): number {
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / 86_400_000);
}

export function localDateKey(at: Date, timezone: string): string {
  return dateKey(localDateParts(at, timezone));
}

export function businessDateContext(
  scope: "organisation" | "centre",
  id: string,
  timezone: string,
  at: Date,
): DailyBusinessDateContext {
  return { scope, id, timezone: requireIanaTimezone(timezone), date: localDateKey(at, timezone) };
}

export function classifyDueAt(
  dueAt: Date,
  decisionAt: Date,
  timezone: string,
): DailyDueInformation {
  const dueLocal = localDateParts(dueAt, timezone);
  const todayLocal = localDateParts(decisionAt, timezone);
  const daysFromToday = calendarOrdinal(dueLocal) - calendarOrdinal(todayLocal);
  const bucket = dueAt.getTime() < decisionAt.getTime()
    ? "OVERDUE"
    : daysFromToday === 0
      ? "TODAY"
      : daysFromToday === 1
        ? "TOMORROW"
        : daysFromToday >= 2 && daysFromToday <= 7
          ? "DUE_SOON"
          : "LATER";
  return {
    at: dueAt.toISOString(),
    timezone,
    localDate: dateKey(dueLocal),
    bucket,
    daysFromToday,
  };
}

export function occurredOnLocalDate(
  occurredAt: Date,
  decisionAt: Date,
  timezone: string,
): boolean {
  return localDateKey(occurredAt, timezone) === localDateKey(decisionAt, timezone);
}
