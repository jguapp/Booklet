"use client";

import { useRef, useState } from "react";
import { useAuth } from "@/lib/auth/auth-provider";
import { exportAsMarkdownZip, importUrls, parseImportCsv } from "@/lib/data/export-import";
import { cn } from "@/lib/cn";

/**
 * Its own page (not a Settings subsection) so it can actually show what
 * each integration is/does -- a flat list of buttons in Settings had no
 * room for that. Pocket and Instapaper import through the same generic,
 * header-name-based CSV parser (see lib/data/export-import.ts) since their
 * exports differ only in column layout, not in what they contain -- a URL
 * per row. The Markdown export is the one deliverable that already covers
 * both Notion and Obsidian (both accept a Markdown/zip import natively),
 * so there's one working export action, presented against both.
 */

const BADGE_CLASS: Record<string, string> = {
  pocket: "bg-[#EF3F56]/12 text-[#EF3F56]",
  instapaper: "bg-ink/10 text-ink",
  readwise: "bg-[#FF6154]/12 text-[#FF6154]",
  notion: "bg-ink/10 text-ink",
  obsidian: "bg-[#7C3AED]/12 text-[#7C3AED]",
};

function ServiceBadge({ id, letter }: { id: string; letter: string }) {
  return (
    <div
      className={cn(
        "flex h-10 w-10 shrink-0 items-center justify-center rounded-md font-serif text-base font-semibold",
        BADGE_CLASS[id],
      )}
      aria-hidden
    >
      {letter}
    </div>
  );
}

export default function ImportExportPage() {
  const { status } = useAuth();
  const importInputRef = useRef<HTMLInputElement>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const rows = parseImportCsv(await file.text());
    if (rows.length === 0) {
      setImportStatus("Couldn't find a URL column in that file.");
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

  async function handleExport() {
    setExporting(true);
    try {
      await exportAsMarkdownZip(status === "authenticated");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-8 py-10">
      <h1 className="mb-1 font-serif text-2xl font-semibold text-ink">Import &amp; Export</h1>
      <p className="mb-10 font-sans text-sm text-ink-muted">
        Bring your existing library in, or take everything you&apos;ve saved and highlighted back out.
      </p>

      <input ref={importInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleImportFile} />

      <section className="mb-10">
        <h2 className="mb-3 font-sans text-xs font-semibold uppercase tracking-wide text-ink-faint">Import</h2>
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-4 rounded-md border border-border bg-surface px-4 py-3.5">
            <ServiceBadge id="pocket" letter="P" />
            <div className="min-w-0 flex-1">
              <p className="font-sans text-sm font-medium text-ink">Pocket</p>
              <p className="font-sans text-xs text-ink-faint">
                Export your list from Pocket as a CSV, then import it here. Each URL is fetched and saved for real.
              </p>
            </div>
            <button
              type="button"
              disabled={importing}
              onClick={() => importInputRef.current?.click()}
              className="shrink-0 rounded-sm border border-border bg-surface-2 px-3 py-1.5 font-sans text-xs font-medium text-ink transition-colors hover:bg-surface disabled:opacity-50"
            >
              Choose CSV
            </button>
          </div>

          <div className="flex items-center gap-4 rounded-md border border-border bg-surface px-4 py-3.5">
            <ServiceBadge id="instapaper" letter="I" />
            <div className="min-w-0 flex-1">
              <p className="font-sans text-sm font-medium text-ink">Instapaper</p>
              <p className="font-sans text-xs text-ink-faint">
                Same as Pocket -- export your CSV from Instapaper&apos;s settings, then import it here.
              </p>
            </div>
            <button
              type="button"
              disabled={importing}
              onClick={() => importInputRef.current?.click()}
              className="shrink-0 rounded-sm border border-border bg-surface-2 px-3 py-1.5 font-sans text-xs font-medium text-ink transition-colors hover:bg-surface disabled:opacity-50"
            >
              Choose CSV
            </button>
          </div>

          <div className="flex items-center gap-4 rounded-md border border-dashed border-border px-4 py-3.5 opacity-70">
            <ServiceBadge id="readwise" letter="R" />
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
          <div className="flex items-center gap-4 rounded-md border border-border bg-surface px-4 py-3.5">
            <ServiceBadge id="obsidian" letter="O" />
            <div className="min-w-0 flex-1">
              <p className="font-sans text-sm font-medium text-ink">Obsidian</p>
              <p className="font-sans text-xs text-ink-faint">
                One Markdown file per article, with its highlights -- unzip straight into a vault.
              </p>
            </div>
            <button
              type="button"
              disabled={exporting}
              onClick={handleExport}
              className="shrink-0 rounded-sm border border-border bg-surface-2 px-3 py-1.5 font-sans text-xs font-medium text-ink transition-colors hover:bg-surface disabled:opacity-50"
            >
              {exporting ? "Exporting…" : "Export .zip"}
            </button>
          </div>

          <div className="flex items-center gap-4 rounded-md border border-border bg-surface px-4 py-3.5">
            <ServiceBadge id="notion" letter="N" />
            <div className="min-w-0 flex-1">
              <p className="font-sans text-sm font-medium text-ink">Notion</p>
              <p className="font-sans text-xs text-ink-faint">
                Same Markdown export -- Notion&apos;s own Import menu accepts a zip of Markdown files directly.
              </p>
            </div>
            <button
              type="button"
              disabled={exporting}
              onClick={handleExport}
              className="shrink-0 rounded-sm border border-border bg-surface-2 px-3 py-1.5 font-sans text-xs font-medium text-ink transition-colors hover:bg-surface disabled:opacity-50"
            >
              {exporting ? "Exporting…" : "Export .zip"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
