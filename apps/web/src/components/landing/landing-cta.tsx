import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { BookletLogo } from "@/components/ui/logo";
import { Container } from "./section";

const FOOTER_SECTIONS = [
  {
    heading: "Product",
    links: [
      { href: "#how-it-works", label: "How it works" },
      { href: "#resurfacing", label: "Resurfacing" },
      { href: "#documents", label: "PDF & EPUB" },
      { href: "#listen", label: "Read aloud" },
      { href: "#features", label: "All features" },
    ],
  },
  {
    heading: "Get started",
    links: [
      { href: "/library", label: "Open your library" },
      { href: "/signup", label: "Create an account" },
      { href: "/login", label: "Log in" },
      { href: "#developers", label: "API & webhooks" },
    ],
  },
];

export function LandingCta() {
  return (
    <>
      <section className="relative overflow-hidden border-t border-border bg-surface">
        {/* Ruled lines behind the closing pitch -- the one place on the page
            where the "it's a page, not a dashboard" idea gets stated
            literally. Behind the text at low opacity, so it never fights the
            copy sitting on it. */}
        <div className="landing-ruled pointer-events-none absolute inset-0 opacity-60" aria-hidden />

        <Container className="relative flex flex-col items-center gap-7 py-24 text-center sm:py-28">
          <BookletLogo className="h-10 w-10" />
          <h2 className="max-w-2xl text-balance font-serif text-3xl font-semibold leading-[1.12] tracking-[-0.015em] text-ink sm:text-[2.75rem]">
            Start with one article. See what you still remember next week.
          </h2>
          <p className="max-w-xl text-pretty font-sans text-base leading-relaxed text-ink-muted">
            No email, no password, no trial to run out. Open your library, paste a link, and highlight
            something — Booklet will bring it back to you.
          </p>
          <div className="mt-1 flex w-full flex-col items-stretch gap-3 sm:w-auto sm:flex-row sm:items-center sm:justify-center">
            <ButtonLink href="/library" variant="primary" className="px-6 py-3 text-base">
              Continue without an account
            </ButtonLink>
            <ButtonLink href="/signup" variant="secondary" className="px-6 py-3 text-base">
              Create an account to sync
            </ButtonLink>
          </div>
        </Container>
      </section>

      <footer className="border-t border-border bg-paper">
        <Container className="flex flex-col gap-12 py-14 lg:flex-row lg:justify-between lg:gap-16">
          <div className="flex max-w-sm flex-col gap-3">
            <div className="flex items-center gap-2.5">
              <BookletLogo className="h-6 w-6" />
              <span className="font-serif text-base font-semibold text-ink">Booklet</span>
            </div>
            <p className="font-sans text-sm leading-relaxed text-ink-muted">
              Save what you find. Keep what you highlight.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-10 sm:gap-16">
            {FOOTER_SECTIONS.map((section) => (
              <div key={section.heading} className="flex flex-col gap-3">
                <p className="font-sans text-xs font-semibold uppercase tracking-[0.14em] text-ink-faint">
                  {section.heading}
                </p>
                <ul className="flex flex-col gap-2.5">
                  {section.links.map((link) => (
                    <li key={link.href}>
                      {/* Anchors stay plain <a> -- next/link on a same-page
                          hash goes through the router for no benefit. */}
                      {link.href.startsWith("#") ? (
                        <a
                          href={link.href}
                          className="font-sans text-sm text-ink-muted transition-colors hover:text-ink"
                        >
                          {link.label}
                        </a>
                      ) : (
                        <Link
                          href={link.href}
                          className="font-sans text-sm text-ink-muted transition-colors hover:text-ink"
                        >
                          {link.label}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Container>

        <div className="border-t border-border">
          <Container className="flex flex-col gap-2 py-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="font-sans text-xs text-ink-faint">
              © {new Date().getFullYear()} Booklet. Proprietary software — all rights reserved.
            </p>
            <p className="font-sans text-xs text-ink-faint">
              Built with Literata &amp; Work Sans. Themes: Paper, Lamp, Night, Kindle.
            </p>
          </Container>
        </div>
      </footer>
    </>
  );
}
