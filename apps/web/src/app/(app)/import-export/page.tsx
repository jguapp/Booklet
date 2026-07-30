"use client";

import { useRef, useState } from "react";
import { useAuth } from "@/lib/auth/auth-provider";
import {
  exportAsAnkiText,
  exportAsMarkdownZip,
  importUrls,
  parseBookmarksHtml,
  parseImportCsv,
  type ImportRow,
} from "@/lib/data/export-import";
import {
  IconInstapaperLogo,
  IconLogseqLogo,
  IconNotionLogo,
  IconObsidianLogo,
  IconRoamResearchLogo,
} from "@/components/ui/brand-icons";
import { IconGlobe } from "@/components/ui/icons";
import { cn } from "@/lib/cn";

/**
 * Its own page (not a Settings subsection) so it can actually show what
 * each integration is/does -- a flat list of buttons in Settings had no
 * room for that. Pocket and Instapaper (and any browser's bookmark
 * export) all import through the same generic URL-list pipeline (see
 * lib/data/export-import.ts) since what they actually contain is always
 * "a URL, maybe a title" -- only the file format parsing differs. The
 * Markdown export is the one deliverable that already covers Obsidian,
 * Notion, and Logseq (all three accept a folder/zip of plain Markdown
 * files), so there's one working export action presented against three
 * destinations.
 *
 * Logos are real brand marks (Simple Icons, CC0 -- see brand-icons.tsx),
 * not generic placeholders. Pocket and Readwise have no entry there, so
 * those two fall back to a plain letter badge.
 */

const BADGE_CLASS: Record<string, string> = {
  pocket: "bg-[#EF3F56]/12 text-[#EF3F56]",
  instapaper: "bg-ink/10 text-ink",
  bookmarks: "bg-accent/10 text-accent",
  readwise: "bg-[#FF6154]/12 text-[#FF6154]",
  notion: "bg-ink/10 text-ink",
  obsidian: "bg-[#7C3AED]/12 text-[#7C3AED]",
  logseq: "bg-[#85C8C8]/20 text-[#4A9999]",
  roam: "bg-ink/10 text-ink",
  anki: "bg-[#2496DE]/12 text-[#2496DE]",
};

function ServiceBadge({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <div
      className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-md p-2.5", BADGE_CLASS[id])}
      aria-hidden
    >
      {children}
    </div>
  );
}

function ImportRowCard({
  id,
  icon,
  name,
  description,
  buttonLabel,
  disabled,
  onClick,
}: {
  id: string;
  icon: React.ReactNode;
  name: string;
  description: string;
  buttonLabel: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <div className="flex items-center gap-4 rounded-md border border-border bg-surface px-4 py-3.5">
      <ServiceBadge id={id}>{icon}</ServiceBadge>
      <div className="min-w-0 flex-1">
        <p className="font-sans text-sm font-medium text-ink">{name}</p>
        <p className="font-sans text-xs text-ink-faint">{description}</p>
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className="shrink-0 rounded-sm border border-border bg-surface-2 px-3 py-1.5 font-sans text-xs font-medium text-ink transition-colors hover:bg-surface disabled:opacity-50"
      >
        {buttonLabel}
      </button>
    </div>
  );
}

export default function ImportExportPage() {
  const { status } = useAuth();
  const csvInputRef = useRef<HTMLInputElement>(null);
  const bookmarksInputRef = useRef<HTMLInputElement>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportingAnki, setExportingAnki] = useState(false);

  async function runImport(rows: ImportRow[]) {
    if (rows.length === 0) {
      setImportStatus("Couldn't find any URLs in that file.");
      return;
    }
    setImporting(true);
    setImportStatus(`Importing 0 / ${rows.length}…`);
    const result = await importUrls(rows, status === "authenticated", (done, total) =>
      setImportStatus(`Importing ${done} / ${total}…`),
    );
    setImporting(false);
    setImportStatus(`Imported ${result.imported}, skipped ${result.skipped} already-saved, ${result.failed} failed.`);
  }

  async function handleCsvFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    await runImport(parseImportCsv(await file.text()));
  }

  async function handleBookmarksFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    await runImport(parseBookmarksHtml(await file.text()));
  }

  async function handleExport() {
    setExporting(true);
    try {
      await exportAsMarkdownZip(status === "authenticated");
    } finally {
      setExporting(false);
    }
  }

  async function handleAnkiExport() {
    setExportingAnki(true);
    try {
      await exportAsAnkiText(status === "authenticated");
    } finally {
      setExportingAnki(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-8 py-10">
      <h1 className="mb-1 font-serif text-2xl font-semibold text-ink">Import &amp; Export</h1>
      <p className="mb-10 font-sans text-sm text-ink-muted">
        Bring your existing library in, or take everything you&apos;ve saved and highlighted back out.
      </p>

      <input ref={csvInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleCsvFile} />
      <input
        ref={bookmarksInputRef}
        type="file"
        accept=".html,text/html"
        className="hidden"
        onChange={handleBookmarksFile}
      />

      <section className="mb-10">
        <h2 className="mb-3 font-sans text-xs font-semibold uppercase tracking-wide text-ink-faint">Import</h2>
        <div className="flex flex-col gap-3">
          <ImportRowCard
            id="pocket"
            icon={<span className="font-serif text-base font-semibold">P</span>}
            name="Pocket"
            description="Export your list from Pocket as a CSV, then import it here. Each URL is fetched and saved for real."
            buttonLabel="Choose CSV"
            disabled={importing}
            onClick={() => csvInputRef.current?.click()}
          />

          <ImportRowCard
            id="instapaper"
            icon={<IconInstapaperLogo className="h-full w-full" />}
            name="Instapaper"
            description="Same as Pocket -- export your CSV from Instapaper's settings, then import it here."
            buttonLabel="Choose CSV"
            disabled={importing}
            onClick={() => csvInputRef.current?.click()}
          />

          <ImportRowCard
            id="bookmarks"
            icon={<IconGlobe className="h-full w-full" />}
            name="Browser bookmarks"
            description="Any browser's bookmarks export (Chrome, Firefox, Safari, Edge) -- every bookmarked page gets saved."
            buttonLabel="Choose file"
            disabled={importing}
            onClick={() => bookmarksInputRef.current?.click()}
          />

          <div className="flex items-center gap-4 rounded-md border border-dashed border-border px-4 py-3.5 opacity-70">
            <ServiceBadge id="readwise">
              <span className="font-serif text-base font-semibold">R</span>
            </ServiceBadge>
            <div className="min-w-0 flex-1">
              <p className="font-sans text-sm font-medium text-ink">Readwise</p>
              <p className="font-sans text-xs text-ink-faint">
                Readwise exports highlights, not just URLs -- bringing those in properly (attached to the right
                article, not re-extracted from scratch) needs its own importer.{" "}
                <a
                  href="https://github.com/jguapp/Booklet/issues"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent"
                >
                  Tracked on the roadmap
                </a>
                .
              </p>
            </div>
            <span className="shrink-0 font-sans text-xs font-medium text-ink-faint">Coming soon</span>
          </div>
        </div>
        {importStatus && <p className="mt-3 font-sans text-sm text-ink-muted">{importStatus}</p>}
      </section>

      <section>
        <h2 className="mb-3 font-sans text-xs font-semibold uppercase tracking-wide text-ink-faint">Export</h2>
        <div className="flex flex-col gap-3">
          <ImportRowCard
            id="obsidian"
            icon={<IconObsidianLogo className="h-full w-full" />}
            name="Obsidian"
            description="One Markdown file per article, with its highlights -- unzip straight into a vault."
            buttonLabel={exporting ? "Exporting…" : "Export .zip"}
            disabled={exporting}
            onClick={handleExport}
          />

          <ImportRowCard
            id="notion"
            icon={<IconNotionLogo className="h-full w-full" />}
            name="Notion"
            description="Same Markdown export -- Notion's own Import menu accepts a zip of Markdown files directly."
            buttonLabel={exporting ? "Exporting…" : "Export .zip"}
            disabled={exporting}
            onClick={handleExport}
          />

          <ImportRowCard
            id="logseq"
            icon={<IconLogseqLogo className="h-full w-full" />}
            name="Logseq"
            description="Same Markdown export -- drop the unzipped files into a Logseq graph's pages folder."
            buttonLabel={exporting ? "Exporting…" : "Export .zip"}
            disabled={exporting}
            onClick={handleExport}
          />

          <div className="flex items-center gap-4 rounded-md border border-dashed border-border px-4 py-3.5 opacity-70">
            <ServiceBadge id="roam">
              <IconRoamResearchLogo className="h-full w-full" />
            </ServiceBadge>
            <div className="min-w-0 flex-1">
              <p className="font-sans text-sm font-medium text-ink">Roam Research</p>
              <p className="font-sans text-xs text-ink-faint">
                Roam&apos;s block-graph format isn&apos;t plain Markdown -- needs its own exporter to bring
                highlights in as properly linked blocks rather than flat text.
              </p>
            </div>
            <span className="shrink-0 font-sans text-xs font-medium text-ink-faint">Coming soon</span>
          </div>

          <ImportRowCard
            id="anki"
            icon={<span className="font-serif text-base font-semibold">A</span>}
            name="Anki"
            description="Every highlight as a flashcard (front: the highlight, back: your note or the source) -- Anki's own File > Import reads this with zero setup."
            buttonLabel={exportingAnki ? "Exporting…" : "Export .txt"}
            disabled={exportingAnki}
            onClick={handleAnkiExport}
          />
        </div>
      </section>
    </div>
  );
}
