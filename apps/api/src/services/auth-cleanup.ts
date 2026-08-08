import { prisma } from "../lib/prisma.js";

/**
 * Sweeps auth rows that can no longer authenticate anything (S8).
 *
 * Refresh rotates -- it revokes the presented token and issues a new Session
 * row -- which is the right design and the reason this file exists. Nothing
 * deleted the revoked row, and the "signed-in devices" list filters
 * `revokedAt: null`, so the table grew behind a UI that looked immaculate.
 * A user who reloads a few tabs an hour produces on the order of 96 dead rows
 * a day, ~35k a year, each one an entry in the unique index on
 * refreshTokenHash that every single refresh probes. The first symptom is not
 * an error; it is refresh getting slower for everybody, which reads as "the
 * app feels slow" and sends you looking anywhere but at a table nobody has
 * ever had to sweep. PasswordResetToken and EmailVerificationToken have the
 * same shape with a much lower rate, and had no cleanup either.
 *
 * Lazy and request-triggered rather than scheduled, mirroring
 * purgeExpiredTrash in routes/articles.ts, for the same reason it exists
 * there: this app has no scheduler, no worker and no cron. Adding one for a
 * DELETE would mean a second process to deploy, supervise and page someone
 * about -- and a cron that silently stopped firing would restore exactly the
 * invisible growth this is here to prevent, whereas a sweep hung off the
 * busiest route cannot stop running while the app is being used at all.
 */

/**
 * How long a dead row is kept after it stops being usable.
 *
 * Seven days, and the constraint that sets it is not storage. A revoked
 * session is the only server-side record that someone was signed in from that
 * IP and that user agent, and it is what a user is actually asking for when
 * they open "where am I signed in" after something felt wrong -- typically
 * after a weekend, or after getting back from a week away. Sweeping on a
 * shorter window would delete the evidence before the question gets asked.
 *
 * The upper bound is arithmetic: retention is directly a multiplier on the
 * steady-state table size, ~96 rows per active user per day. Seven days holds
 * an active user at a few hundred rows instead of tens of thousands a year --
 * flat, not growing, which is the property that matters. Thirty days would
 * also be flat, at four times the size, and buys history that the sessions
 * list does not currently render (it filters revoked rows out entirely), so
 * it would be paid for and not used.
 *
 * The two token tables share the window rather than getting their own. They
 * expire in an hour and a day respectively, so anything past this cutoff is
 * long unusable, and a used reset token is evidence in the same "was that
 * me?" conversation a revoked session is.
 */
export const AUTH_ROW_RETENTION_DAYS = 7;

/**
 * The floor between sweeps. Refresh is the app's most frequent authenticated
 * request, so without this the sweep would be a table-wide DELETE on every
 * one of them -- fixing a latency problem by causing a worse one.
 *
 * Process-local on purpose. Behind N instances this is N sweeps an hour
 * rather than one; the sweep is idempotent and deleting rows another instance
 * already deleted costs a no-op, so the shared store that would make this
 * exact is not worth requiring.
 */
const SWEEP_MIN_INTERVAL_MS = 60 * 60 * 1000;

let lastSweepStartedAt = 0;

export interface AuthSweepCounts {
  sessions: number;
  passwordResetTokens: number;
  emailVerificationTokens: number;
}

/**
 * Deletes every auth row that has been unusable for longer than the retention
 * window. Unconditional -- callers on a hot path want maybePurge below.
 */
export async function purgeExpiredAuthRows(now: Date = new Date()): Promise<AuthSweepCounts> {
  const cutoff = new Date(now.getTime() - AUTH_ROW_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  // Two arms because a session stops being usable at two different moments
  // and the window has to run from whichever one applies. Rotation revokes a
  // row while 30 days of its TTL are still ahead of it, so keying only on
  // expiresAt would hold every rotated row for a month past the point it
  // could authenticate anything -- that is the bulk of the table. Keying only
  // on revokedAt would never touch a session that simply timed out, because
  // nothing ever revokes those.
  //
  // The `revokedAt: null` on the second arm is what keeps the two disjoint:
  // an already-expired row that something revoked recently (revoke-others
  // does not filter on expiry) is matched by neither, and stays for the full
  // window measured from the revocation.
  const sessions = await prisma.session.deleteMany({
    where: {
      OR: [{ revokedAt: { lt: cutoff } }, { revokedAt: null, expiresAt: { lt: cutoff } }],
    },
  });

  // No `usedAt` arm for either table. A used token is dead immediately, but
  // its expiry is an hour (reset) or a day (verification) away, so the
  // expiresAt cutoff collects it within a rounding error of the same time,
  // and one predicate cannot disagree with itself about what is deletable.
  const passwordResetTokens = await prisma.passwordResetToken.deleteMany({ where: { expiresAt: { lt: cutoff } } });
  const emailVerificationTokens = await prisma.emailVerificationToken.deleteMany({
    where: { expiresAt: { lt: cutoff } },
  });

  return {
    sessions: sessions.count,
    passwordResetTokens: passwordResetTokens.count,
    emailVerificationTokens: emailVerificationTokens.count,
  };
}

/**
 * The hot-path entry point: sweeps at most once per interval, and never
 * throws.
 *
 * Best-effort in the same sense purgeExpiredTrash is -- a failure here means
 * the sweep happens on a later request, and it must never turn a successful
 * refresh into a 500. Awaited by its caller rather than fired and forgotten,
 * so an error has somewhere to go and the work is bounded by the request that
 * asked for it instead of piling up unobserved.
 *
 * Returns the counts when it swept and null when the throttle held it back,
 * which is also how the tests drive it.
 *
 * onError exists because the thing this module prevents is invisible growth,
 * and a sweep that has been failing since the last deploy would be invisible
 * in exactly the same way. Nothing should page on it -- one failure is a
 * retry an hour later -- but it must not be silent.
 *
 * @param minIntervalMs 0 forces a sweep; only the tests pass anything.
 */
export async function maybePurgeExpiredAuthRows(
  minIntervalMs: number = SWEEP_MIN_INTERVAL_MS,
  onError?: (err: unknown) => void,
): Promise<AuthSweepCounts | null> {
  const now = Date.now();
  if (now - lastSweepStartedAt < minIntervalMs) return null;
  // Claimed before the await, not after: concurrent refreshes all read the
  // old timestamp otherwise and every one of them runs the same DELETE.
  lastSweepStartedAt = now;

  try {
    return await purgeExpiredAuthRows();
  } catch (err) {
    onError?.(err);
    return null;
  }
}
