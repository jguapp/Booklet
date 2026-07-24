import { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type CardProps = HTMLAttributes<HTMLDivElement>;

export function Card({ className, ...props }: CardProps) {
  return (
    <div
      className={cn("rounded-md border border-border bg-surface px-5 py-4", className)}
      {...props}
    />
  );
}

export function CardKicker({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("font-sans text-xs font-semibold uppercase tracking-wide text-ink-faint", className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("mt-1 mb-2 font-serif text-lg text-ink", className)} {...props} />;
}
