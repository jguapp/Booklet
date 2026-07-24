import { ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

const variantClasses: Record<Variant, string> = {
  primary: "bg-accent text-accent-contrast hover:bg-accent-strong",
  secondary: "bg-transparent text-ink border border-border hover:bg-surface-2",
  ghost: "bg-transparent text-ink-muted hover:text-ink hover:bg-surface-2",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", className, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded-sm px-5 py-2.5 font-sans text-sm font-semibold transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed",
          variantClasses[variant],
          className,
        )}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";
