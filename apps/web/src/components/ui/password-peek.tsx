"use client";

import Link from "next/link";
import { createContext, useContext, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

interface PasswordPeekValue {
  revealed: boolean;
  setRevealed: (revealed: boolean) => void;
}

const PasswordPeekContext = createContext<PasswordPeekValue | null>(null);

/** Null when there's no provider -- PasswordInput then just keeps the state
 * locally, so it still works anywhere outside an auth page. */
export function usePasswordPeek(): PasswordPeekValue | null {
  return useContext(PasswordPeekContext);
}

/**
 * Shares "is the password on screen right now" between the field's own toggle
 * and the Booklet mark at the top of the page, which are deliberately far
 * apart in the tree. Context rather than prop drilling because the mark sits
 * above the card the form lives in, so there's no common parent to thread it
 * through without every auth page re-plumbing its layout.
 */
export function PasswordPeekProvider({ children }: { children: ReactNode }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <PasswordPeekContext.Provider value={{ revealed, setRevealed }}>{children}</PasswordPeekContext.Provider>
  );
}

/**
 * The Booklet mark as a character: it slaps its hands over its eyes while
 * your password is visible, and drops them when you hide it again.
 *
 * aria-hidden -- the toggle button already announces the same state properly,
 * and narrating a cartoon covering its eyes would be noise, not information.
 * The point is a second, unmissable read on "my password is on screen" for
 * sighted users, which a 16px eye icon doesn't really give you.
 */
function PeekabooMark({ hiding }: { hiding: boolean }) {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden
      className={cn(
        "h-16 w-16 transition-transform duration-300 ease-out motion-reduce:transition-none",
        hiding ? "-rotate-3" : "rotate-0",
      )}
    >
      <rect x="1" y="1" width="62" height="62" rx="17" className="fill-accent" />

      <g
        data-testid="peek-eyes-open"
        className={cn("transition-opacity duration-200 motion-reduce:transition-none", hiding ? "opacity-0" : "opacity-100")}
      >
        <circle cx="24" cy="28" r="3.6" className="fill-accent-contrast" />
        <circle cx="40" cy="28" r="3.6" className="fill-accent-contrast" />
      </g>

      {/* Scrunched-shut eyes. An earlier pass had hands swinging up to cover
          them instead, which looked right in the abstract and read as two
          wide-open white eyes on screen -- exactly the opposite signal. Two
          arcs are unambiguous at this size. */}
      <g
        data-testid="peek-eyes-shut"
        className={cn("transition-opacity duration-200 motion-reduce:transition-none", hiding ? "opacity-100" : "opacity-0")}
        fill="none"
        strokeWidth="3"
        strokeLinecap="round"
      >
        <path d="M18 30q6-7 12 0" className="stroke-accent-contrast" />
        <path d="M34 30q6-7 12 0" className="stroke-accent-contrast" />
      </g>

      <path
        d={hiding ? "M25 42q7 6 14 0" : "M26.5 42q5.5 4 11 0"}
        fill="none"
        strokeWidth="2.4"
        strokeLinecap="round"
        className="stroke-accent-contrast transition-all duration-200 motion-reduce:transition-none"
      />
    </svg>
  );
}

/**
 * Drop-in replacement for the plain "Booklet" wordmark on the auth pages.
 * Works without a PasswordPeekProvider too (forgot-password has no password
 * field) -- it just sits there eyes-open, so all four pages still match.
 */
export function BookletPeekMark({ className }: { className?: string }) {
  const peek = usePasswordPeek();

  return (
    <Link href="/" className={cn("mb-8 flex flex-col items-center gap-2.5", className)} aria-label="Booklet home">
      <PeekabooMark hiding={peek?.revealed ?? false} />
      <span className="font-serif text-xl font-semibold text-ink">Booklet</span>
    </Link>
  );
}
