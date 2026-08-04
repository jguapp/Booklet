"use client";

import { InputHTMLAttributes, forwardRef, useState } from "react";
import { Input } from "./input";
import { IconEye, IconEyeOff } from "./icons";
import { usePasswordPeek } from "./password-peek";
import { cn } from "@/lib/cn";

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className, ...props }, ref) => {
    // Inside an auth page this is shared with the Booklet mark up top, which
    // covers its eyes in sync. Outside one, it falls back to local state so
    // the component still stands on its own.
    const peek = usePasswordPeek();
    const [localVisible, setLocalVisible] = useState(false);
    const visible = peek ? peek.revealed : localVisible;
    const setVisible = peek ? peek.setRevealed : setLocalVisible;

    return (
      <div className="relative">
        <Input
          ref={ref}
          type={visible ? "text" : "password"}
          // Room for the toggle, so a long password never runs under it.
          className={cn("w-full pr-11", className)}
          {...props}
        />

        <button
          type="button" // never "submit" -- this sits inside a form
          onClick={() => setVisible(!visible)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-sm text-ink-faint transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {visible ? <IconEyeOff className="h-[18px] w-[18px]" /> : <IconEye className="h-[18px] w-[18px]" />}
        </button>
      </div>
    );
  },
);
PasswordInput.displayName = "PasswordInput";
