import { ButtonLink } from "@/components/ui/button";

// Next.js's special-cased filename -- rendered automatically for any URL
// that doesn't match a route, and by any in-app notFound() call. No
// "use client" needed (nothing here is interactive beyond a plain link).
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-paper px-6 text-center">
      <p className="font-sans text-xs font-medium uppercase tracking-wide text-ink-faint">404</p>
      <h1 className="font-serif text-2xl font-semibold text-ink">That page doesn&apos;t exist.</h1>
      <p className="max-w-sm font-sans text-sm text-ink-muted">
        The link might be broken, or the page may have moved. Your library is still where you left it.
      </p>
      <ButtonLink href="/library" variant="primary" className="mt-2">
        Back to Library
      </ButtonLink>
    </div>
  );
}
