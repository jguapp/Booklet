import Link from "next/link";

/**
 * The one place /privacy and /terms are reachable from without already
 * knowing the URL (#174).
 *
 * On the login and signup pages rather than in the root layout: those are the
 * two screens where someone is deciding whether to hand over their reading to
 * a server, which is the moment the privacy policy is actually worth reading.
 * The signed-in app links to it from Settings, next to the delete-account
 * control it explains.
 */
export function LegalFooter() {
  return (
    <p className="mt-6 text-center font-sans text-xs text-ink-faint">
      <Link href="/privacy" className="hover:text-ink-muted">
        Privacy
      </Link>
      <span className="mx-2">·</span>
      <Link href="/terms" className="hover:text-ink-muted">
        Terms
      </Link>
    </p>
  );
}
