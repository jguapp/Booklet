import Link from "next/link";

/**
 * Shared chrome for /privacy and /terms (#174).
 *
 * Both live outside the `(app)` route group, for the same structural reason
 * `/s/[slug]` does (see its comment): that group's layout is the signed-in
 * shell -- sidebar, collection tree, the account's own email in the corner --
 * and these two pages have to be readable by someone deciding whether to
 * create an account at all. Being outside the group means that cannot
 * regress the next time the shell changes.
 */
export function LegalShell({
  title,
  updated,
  children,
}: {
  title: string;
  /** ReactNode, not string -- until these are actually published the date is
   * itself an unfilled <Blank>, and typing it as a string would have forced
   * a fake one. */
  updated: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-paper px-6 py-12">
      <div className="mx-auto w-full max-w-2xl">
        <Link href="/" className="font-sans text-xs font-medium text-ink-muted hover:text-ink">
          ← Booklet
        </Link>

        <h1 className="mt-6 font-serif text-2xl font-semibold text-ink">{title}</h1>
        <p className="mt-1 font-sans text-xs text-ink-faint">Last updated: {updated}</p>

        <div className="mt-8 flex flex-col gap-6 font-sans text-sm leading-relaxed text-ink-muted [&_a]:font-medium [&_a]:text-accent [&_code]:font-mono [&_code]:text-xs [&_code]:text-ink [&_h2]:font-serif [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-ink [&_li]:mt-1.5 [&_strong]:font-semibold [&_strong]:text-ink [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:pl-5">
          {children}
        </div>

        <p className="mt-10 border-t border-border pt-4 font-sans text-xs text-ink-faint">
          <Link href="/privacy" className="font-medium text-accent">
            Privacy
          </Link>
          {" · "}
          <Link href="/terms" className="font-medium text-accent">
            Terms
          </Link>
        </p>
      </div>
    </div>
  );
}

/**
 * An unfilled blank, rendered so it is impossible to mistake for filled in.
 *
 * These pages describe software that exists; they cannot describe a company,
 * an address or a jurisdiction that has not been decided yet. Inventing any
 * of those would make the document look complete while being false in
 * exactly the places a reader would rely on it -- who to contact, and whose
 * law applies. So every such value is one of these until someone fills it in.
 */
export function Blank({ children }: { children: React.ReactNode }) {
  return (
    <mark className="rounded-sm bg-accent/20 px-1 font-mono text-xs text-ink">[{children}]</mark>
  );
}
