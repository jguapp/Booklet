"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { Collection } from "@booklet/shared";
import { IconHighlights, IconLibrary, IconLogout, IconPlus, IconResurface, IconSettings } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { useAuth } from "@/lib/auth/auth-provider";
import { createCollection, loadCollections } from "@/lib/data/collections";
import { ApiError } from "@/lib/api/client";

const NAV_ITEMS = [
  { href: "/library", label: "Library", Icon: IconLibrary },
  { href: "/highlights", label: "Highlights", Icon: IconHighlights },
  { href: "/resurface", label: "Daily Review", Icon: IconResurface },
  { href: "/settings", label: "Settings", Icon: IconSettings },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { status, isAuthenticated, user, logout } = useAuth();
  const [collections, setCollections] = useState<Collection[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const activeCollectionId = searchParams.get("collection");

  const refreshCollections = useCallback(() => {
    if (status === "loading") return;
    loadCollections(isAuthenticated).then(setCollections);
  }, [status, isAuthenticated]);

  useEffect(() => {
    refreshCollections();
  }, [refreshCollections]);

  async function handleLogout() {
    await logout();
    router.push("/login");
  }

  async function handleCreateCollection(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    try {
      const created = await createCollection({ name }, isAuthenticated);
      setCollections((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setNewName("");
      setCreating(false);
      router.push(`/library?collection=${created.id}`);
    } catch (err) {
      // Name collision is the only realistic failure here -- surface it inline rather than losing the input.
      if (err instanceof ApiError) setNewName(name);
    }
  }

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-surface">
        <div className="px-5 py-6">
          <Link href="/library" className="font-serif text-xl font-semibold text-ink">
            Booklet
          </Link>
        </div>

        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3">
          {NAV_ITEMS.map(({ href, label, Icon }) => {
            const active = (pathname === href || pathname?.startsWith(`${href}/`)) && !activeCollectionId;
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

          <div className="mt-6 flex items-center justify-between px-3">
            <span className="font-sans text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              Collections
            </span>
            <button
              type="button"
              title="New collection"
              onClick={() => setCreating((v) => !v)}
              className="flex h-5 w-5 items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <IconPlus className="h-3 w-3" />
            </button>
          </div>

          {creating && (
            <form onSubmit={handleCreateCollection} className="px-3 py-1">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onBlur={() => !newName && setCreating(false)}
                placeholder="Collection name"
                className="w-full rounded-sm border border-border bg-paper px-2 py-1 font-sans text-xs text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
            </form>
          )}

          {collections.map((c) => (
            <Link
              key={c.id}
              href={`/library?collection=${c.id}`}
              className={cn(
                "flex items-center gap-2.5 rounded-sm px-3 py-1.5 font-sans text-sm transition-colors",
                activeCollectionId === c.id
                  ? "bg-surface-2 text-accent"
                  : "text-ink-muted hover:bg-surface-2 hover:text-ink",
              )}
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: c.color ?? "var(--color-ink-faint)" }}
                aria-hidden
              />
              <span className="truncate">{c.name}</span>
              {typeof c.articleCount === "number" && (
                <span className="ml-auto shrink-0 font-sans text-xs text-ink-faint">{c.articleCount}</span>
              )}
            </Link>
          ))}
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
