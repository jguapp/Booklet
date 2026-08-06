/** One day's worth of active reading time, for the stats page's
 * GitHub-contributions-style heatmap. `date` is an ISO date string
 * (YYYY-MM-DD, always midnight UTC on the server -- see
 * apps/api/prisma/schema.prisma's ReadingActivityDay). Only days with any
 * reading time at all are included -- the client fills in the zero days
 * itself when laying out the grid, same as it already did for the
 * archivedAt-based version this replaced. */
export interface ReadingActivityDay {
  date: string;
  seconds: number;
}

export interface ReadingActivityResponse {
  days: ReadingActivityDay[];
}
