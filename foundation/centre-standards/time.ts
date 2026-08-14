import { requireIanaTimezone } from "../daily-success/time";
import { CentreStandardsError } from "./types";

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^(\d{2}):(\d{2})$/;

function formatter(timezone: string): Intl.DateTimeFormat {
  requireIanaTimezone(timezone);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
}

function partsAt(at: Date, timezone: string): LocalParts {
  const parts = formatter(timezone).formatToParts(at);
  const numberPart = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = parts.find((part) => part.type === type)?.value;
    if (!value) throw new CentreStandardsError("invalid_input", "timezone could not be resolved");
    return Number(value);
  };
  return {
    year: numberPart("year"),
    month: numberPart("month"),
    day: numberPart("day"),
    hour: numberPart("hour"),
    minute: numberPart("minute"),
  };
}

function parseLocal(date: string, time: string): LocalParts {
  const dateMatch = DATE.exec(date);
  const timeMatch = TIME.exec(time);
  if (!dateMatch || !timeMatch) {
    throw new CentreStandardsError("invalid_input", "local date or time is invalid");
  }
  const parts = {
    year: Number(dateMatch[1]),
    month: Number(dateMatch[2]),
    day: Number(dateMatch[3]),
    hour: Number(timeMatch[1]),
    minute: Number(timeMatch[2]),
  };
  const canonical = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (
    parts.hour > 23 ||
    parts.minute > 59 ||
    canonical.getUTCFullYear() !== parts.year ||
    canonical.getUTCMonth() !== parts.month - 1 ||
    canonical.getUTCDate() !== parts.day
  ) {
    throw new CentreStandardsError("invalid_input", "local date or time is invalid");
  }
  return parts;
}

function sameParts(left: LocalParts, right: LocalParts): boolean {
  return left.year === right.year && left.month === right.month && left.day === right.day &&
    left.hour === right.hour && left.minute === right.minute;
}

function offsetMinutes(at: Date, timezone: string): number {
  const local = partsAt(at, timezone);
  const represented = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
  );
  return Math.round((represented - at.getTime()) / 60_000);
}

/**
 * Resolves one local wall-clock minute only when it maps to exactly one UTC
 * instant. DST gaps (zero matches) and folds (two matches) fail closed.
 */
export function resolveStrictLocalMinute(input: {
  businessDate: string;
  localTime: string;
  timezone: string;
}): Date {
  const expected = parseLocal(input.businessDate, input.localTime);
  const nominalUtc = Date.UTC(
    expected.year,
    expected.month - 1,
    expected.day,
    expected.hour,
    expected.minute,
  );
  const offsets = new Set<number>();
  for (const hours of [-48, -24, 0, 24, 48]) {
    offsets.add(offsetMinutes(new Date(nominalUtc + hours * 3_600_000), input.timezone));
  }
  const matches = [...offsets]
    .map((offset) => new Date(nominalUtc - offset * 60_000))
    .filter((candidate) => sameParts(partsAt(candidate, input.timezone), expected));
  const unique = [...new Map(matches.map((candidate) => [candidate.getTime(), candidate])).values()];
  if (unique.length !== 1) {
    throw new CentreStandardsError(
      "invalid_input",
      "schedule wall time is ambiguous or nonexistent in the centre timezone",
    );
  }
  return unique[0];
}

export function localBusinessDate(at: Date, timezone: string): string {
  const value = partsAt(at, timezone);
  return `${String(value.year).padStart(4, "0")}-${String(value.month).padStart(2, "0")}-${String(value.day).padStart(2, "0")}`;
}

export function addLocalCalendarDays(date: string, days: number): string {
  const value = parseLocal(date, "00:00");
  const shifted = new Date(Date.UTC(value.year, value.month - 1, value.day + days));
  return `${String(shifted.getUTCFullYear()).padStart(4, "0")}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}

export function compareLocalDates(left: string, right: string): number {
  parseLocal(left, "00:00");
  parseLocal(right, "00:00");
  return left.localeCompare(right);
}

export function formatLocalMinute(at: Date, timezone: string): string {
  requireIanaTimezone(timezone);
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(at).replace(/\s/g, "").toLowerCase();
}
