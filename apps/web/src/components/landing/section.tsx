import { cn } from "@/lib/cn";

/**
 * Layout primitives shared by every landing section, so the page's vertical
 * rhythm and measure live in one place instead of being retyped (and
 * gradually diverging) in eight sibling files.
 *
 * The measure is deliberately narrower than a typical marketing page: this
 * is an app about reading, and a 72rem content column with a 34rem prose
 * column inside it is roughly the line length the reader itself uses.
 */

const CONTAINER = "mx-auto w-full max-w-[72rem] px-6 sm:px-8";

export function Container({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn(CONTAINER, className)}>{children}</div>;
}

export function Section({
  id,
  className,
  children,
}: {
  id?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    // scroll-mt clears the sticky nav when an in-page anchor lands here --
    // without it the section's own heading ends up underneath the header.
    <section id={id} className={cn("scroll-mt-20 py-20 sm:py-28", className)}>
      <Container>{children}</Container>
    </section>
  );
}

/** Small uppercase label above a section heading. */
export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-sans text-xs font-semibold uppercase tracking-[0.16em] text-accent">{children}</p>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  lead,
  align = "left",
  className,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  lead?: React.ReactNode;
  align?: "left" | "center";
  className?: string;
}) {
  const centered = align === "center";
  return (
    <div className={cn("flex flex-col gap-4", centered && "mx-auto items-center text-center", className)}>
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <h2
        className={cn(
          "text-balance font-serif text-3xl font-semibold leading-[1.15] tracking-[-0.01em] text-ink sm:text-4xl",
          centered ? "max-w-2xl" : "max-w-3xl",
        )}
      >
        {title}
      </h2>
      {lead ? (
        <p className={cn("max-w-2xl text-pretty font-sans text-base leading-relaxed text-ink-muted", centered && "mx-auto")}>
          {lead}
        </p>
      ) : null}
    </div>
  );
}

/** The page's one card treatment -- bordered paper, never a floating shadow. */
export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("rounded-lg border border-border bg-surface p-6", className)}>{children}</div>
  );
}

/** Inline pill used for the hero's trust chips and the "how it works" steps. */
export function Chip({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 font-sans text-xs font-medium text-ink-muted",
        className,
      )}
    >
      {children}
    </span>
  );
}
