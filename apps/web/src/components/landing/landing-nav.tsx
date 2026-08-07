import Link from "next/link";
import { BookletLogo } from "@/components/ui/logo";
import { ThemeSwitcher } from "@/components/ui/theme-switcher";
import { ButtonLink } from "@/components/ui/button";
import { Container } from "./section";

const NAV_LINKS = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#resurfacing", label: "Resurfacing" },
  { href: "#features", label: "Features" },
  { href: "#developers", label: "Developers" },
];

/**
 * The theme switcher is here rather than only in the app shell on purpose:
 * Paper / Lamp / Night / Kindle is a genuine product feature, and letting
 * someone repaint the marketing page with it demonstrates that better than
 * a screenshot of the control would. It's the one client component on an
 * otherwise fully static page.
 */
export function LandingNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-paper/85 backdrop-blur-md">
      <Container className="flex h-16 items-center justify-between gap-6">
        <Link href="/" className="flex items-center gap-2.5" aria-label="Booklet home">
          <BookletLogo className="h-7 w-7" />
          <span className="font-serif text-lg font-semibold tracking-[-0.01em] text-ink">Booklet</span>
        </Link>

        <nav aria-label="Sections" className="hidden items-center gap-1 lg:flex">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-sm px-3 py-2 font-sans text-sm font-medium text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2 sm:gap-3">
          <ThemeSwitcher className="hidden sm:flex" />
          <Link
            href="/login"
            className="rounded-sm px-3 py-2 font-sans text-sm font-semibold text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            Log in
          </Link>
          <ButtonLink href="/library" variant="primary">
            Start reading
          </ButtonLink>
        </div>
      </Container>
    </header>
  );
}
