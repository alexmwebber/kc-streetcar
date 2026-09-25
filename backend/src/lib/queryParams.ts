// Query-string parsing that fails loudly and early.
//
// The original endpoints parsed `since` with a bare `new Date(String(...))`, so a
// garbage value produced an Invalid Date, reached Postgres, and came back as a 500.
// These helpers turn the same input into a 400 with a reason (see asyncHandler).

export class BadRequestError extends Error {}

type QueryValue = unknown;

function firstValue(raw: QueryValue): string | undefined {
  // Express gives an array when a param is repeated (?a=1&a=2); take the first.
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || value === null || value === "") return undefined;
  return String(value);
}

export function parseDate(raw: QueryValue, name: string, fallback: Date): Date {
  const value = firstValue(raw);
  if (value === undefined) return fallback;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestError(`${name} is not a valid date: ${value}`);
  }
  return parsed;
}

const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * A HH:MM pair, or [null, null] when neither is given. Both must appear together -
 * a lone bound is almost always a caller bug, and guessing the other end would
 * silently return the wrong data.
 *
 * A wrapped window (from > to, e.g. 22:00-02:00) is allowed; the SQL handles it.
 */
export function parseTimeOfDay(rawFrom: QueryValue, rawTo: QueryValue): [string | null, string | null] {
  const from = firstValue(rawFrom);
  const to = firstValue(rawTo);

  if (from === undefined && to === undefined) return [null, null];
  if (from === undefined || to === undefined) {
    throw new BadRequestError("todFrom and todTo must be given together");
  }
  for (const [name, value] of [
    ["todFrom", from],
    ["todTo", to],
  ] as const) {
    if (!TIME_OF_DAY.test(value)) {
      throw new BadRequestError(`${name} must be HH:MM in 24-hour time, got: ${value}`);
    }
  }
  if (from === to) {
    throw new BadRequestError("todFrom and todTo must differ (an empty window matches nothing)");
  }
  return [from, to];
}

/** An integer restricted to an explicit allowlist - keeps bin sizes from becoming
 *  an arbitrary-cardinality GROUP BY. */
export function parseEnumInt(raw: QueryValue, name: string, allowed: number[], fallback: number): number {
  const value = firstValue(raw);
  if (value === undefined) return fallback;

  const parsed = Number(value);
  if (!allowed.includes(parsed)) {
    throw new BadRequestError(`${name} must be one of ${allowed.join(", ")}, got: ${value}`);
  }
  return parsed;
}

export function parseIntInRange(raw: QueryValue, name: string, min: number, max: number, fallback: number): number {
  const value = firstValue(raw);
  if (value === undefined) return fallback;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new BadRequestError(`${name} must be an integer between ${min} and ${max}, got: ${value}`);
  }
  return parsed;
}

/** Optional value from a small set, or null when absent. */
export function parseOptionalEnumInt(raw: QueryValue, name: string, allowed: number[]): number | null {
  const value = firstValue(raw);
  if (value === undefined) return null;

  const parsed = Number(value);
  if (!allowed.includes(parsed)) {
    throw new BadRequestError(`${name} must be one of ${allowed.join(", ")}, got: ${value}`);
  }
  return parsed;
}

/** Both ends of a time range, ordered and bounded. */
export function assertRange(from: Date, to: Date, maxDays: number): void {
  if (from >= to) {
    throw new BadRequestError("from must be earlier than to");
  }
  const days = (to.getTime() - from.getTime()) / 86_400_000;
  if (days > maxDays) {
    throw new BadRequestError(`range must not exceed ${maxDays} days (got ${Math.round(days)})`);
  }
}
