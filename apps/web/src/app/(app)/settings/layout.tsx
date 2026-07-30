"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

/**
 * Settings used to be one long scrollable page -- every category stacked
 * top to bottom, which got unwieldy as more got added (reading, library
 * management, digest, import/export, developer). Split into its own
 * per-page nav instead (Readwise-style): one settings-scoped sidebar,
 * one category per route, each independently linkable.
 */
const SETTINGS_NAV = [
  { href: "/settings", label: "Account" },
  { href: "/settings/reading", label: "Reading" },
  { href: "/settings/library", label: "Library" },
  { href: "/settings/digest", label: "Daily Review" },
  { href: "/settings/import-export", label: "Import & Export" },
  { href: "/settings/developer", label: "Developer" },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="mx-auto flex max-w-4xl gap-12 px-8 py-10">
      <nav aria-label="Settings" className="w-40 shrink-0">
        <h1 className="mb-6 font-serif text-xl font-semibold text-ink">Settings</h1>
        <div className="flex flex-col gap-0.5">
          {SETTINGS_NAV.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded-sm px-2.5 py-1.5 font-sans text-sm transition-colors",
                  active ? "bg-accent/10 font-medium text-accent" : "text-ink-muted hover:text-ink",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
      <div className="min-w-0 flex-1 pb-10">{children}</div>
    </div>
  );
}
