/** Midnight UTC of the calendar day `d` falls on -- the canonical form
 * ReadingActivityDay.date is always stored/queried as, so a given day maps
 * to exactly one row no matter what time of day (or which server timezone)
 * a request happens to land in. */
export function utcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
