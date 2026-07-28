"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { IconHighlights, IconLibrary, IconLogout, IconResurface, IconSettings } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { useAuth } from "@/lib/auth/auth-provider";

const NAV_ITEMS = [
  { href: "/library", label: "Library", Icon: IconLibrary },
  { href: "/highlights", label: "Highlights", Icon: IconHighlights },
  { href: "/resurface", label: "Daily Review", Icon: IconResurface },
  { href: "/settings", label: "Settings", Icon: IconSettings },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { status, user, logout } = useAuth();

  async function handleLogout() {
    await logout();
    router.push("/login");
  }

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-surface">
        <div className="px-5 py-6">
          <Link href="/library" className="font-serif text-xl font-semibold text-ink">
            Booklet
          </Link>
        </div>

        <nav className="flex flex-1 flex-col gap-1 px-3">
          {NAV_ITEMS.map(({ href, label, Icon }) => {
            const active = pathname === href || pathname?.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-2.5 rounded-sm px-3 py-2 font-sans text-sm font-medium transition-colors",
                  active ? "bg-surface-2 text-accent" : "text-ink-muted hover:bg-surface-2 hover:text-ink",
                )}
              >
                <Icon className="h-[18px] w-[18px]" />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-border px-3 py-4">
          {status === "authenticated" && user ? (
            <div className="flex items-center justify-between gap-2 rounded-sm px-3 py-2">
              <div className="min-w-0">
                <div className="truncate font-sans text-sm font-medium text-ink">
                  {user.name ?? user.email}
                </div>
                <div className="truncate font-sans text-xs text-ink-faint">{user.email}</div>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                title="Log out"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
              >
                <IconLogout className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <Link
              href="/signup"
              className="block rounded-sm px-3 py-2 font-sans text-xs text-ink-faint transition-colors hover:bg-surface-2 hover:text-ink"
            >
              Saved locally on this device.
              <span className="block font-medium text-accent">Sync across devices →</span>
            </Link>
          )}
        </div>
      </aside>

      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
