import { ButtonHTMLAttributes, forwardRef } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost";

const BUTTON_CLASS =
  "inline-flex items-center justify-center gap-2 rounded-sm px-5 py-2.5 font-sans text-sm font-semibold transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed";

const variantClasses: Record<Variant, string> = {
  primary: "bg-accent text-accent-contrast hover:bg-accent-strong",
  secondary: "bg-transparent text-ink border border-border hover:bg-surface-2",
  ghost: "bg-transparent text-ink-muted hover:text-ink hover:bg-surface-2",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", className, ...props }, ref) => {
    return <button ref={ref} className={cn(BUTTON_CLASS, variantClasses[variant], className)} {...props} />;
  },
);
Button.displayName = "Button";

interface ButtonLinkProps {
  href: string;
  variant?: Variant;
  className?: string;
  children: React.ReactNode;
  title?: string;
}

/** Same look as Button, but a real <a> -- never nest Button inside Link, it's invalid nested-interactive markup. */
export function ButtonLink({ href, variant = "primary", className, children, title }: ButtonLinkProps) {
  return (
    <Link href={href} title={title} className={cn(BUTTON_CLASS, variantClasses[variant], className)}>
      {children}
    </Link>
  );
}
