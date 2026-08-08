"use client";

import { useState } from "react";
import type { Article } from "@booklet/shared";
import { updateArticleTags } from "@/lib/data/articles";
import { useToast } from "@/lib/toast/toast-provider";

const MAX_TAG_LENGTH = 40;

interface TagEditorProps {
  article: Article;
  authenticated: boolean;
  onChange: (article: Article) => void;
}

export function TagEditor({ article, authenticated, onChange }: TagEditorProps) {
  const { toast } = useToast();
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  async function commit(nextTags: string[]) {
    setSaving(true);
    try {
      const updated = await updateArticleTags(article, nextTags, authenticated);
      onChange(updated);
    } catch {
      // try/finally with no catch left this as an unhandled rejection and a
      // tag that simply never appeared -- identical, from the outside, to
      // having mistyped and pressed Enter on an empty field.
      toast("Couldn't save those tags.");
    } finally {
      setSaving(false);
    }
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const tag = draft.trim().slice(0, MAX_TAG_LENGTH);
    if (!tag || article.tags.includes(tag)) {
      setDraft("");
      return;
    }
    setDraft("");
    commit([...article.tags, tag]);
  }

  function handleRemove(tag: string) {
    commit(article.tags.filter((t) => t !== tag));
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {article.tags.map((tag) => (
        <button
          key={tag}
          type="button"
          onClick={() => handleRemove(tag)}
          disabled={saving}
          title={`Remove "${tag}"`}
          className="group flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2.5 py-1 font-sans text-xs text-ink-muted transition-colors hover:border-accent/40 hover:text-ink disabled:opacity-50"
        >
          {tag}
          <span className="text-ink-faint group-hover:text-accent">×</span>
        </button>
      ))}
      <form onSubmit={handleAdd} className="flex items-center">
        <input
          type="text"
          aria-label="Add a tag"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={article.tags.length === 0 ? "Add a tag…" : "Add…"}
          maxLength={MAX_TAG_LENGTH}
          disabled={saving}
          className="w-24 rounded-full border border-dashed border-border bg-transparent px-2.5 py-1 font-sans text-xs text-ink placeholder:text-ink-faint outline-none focus:border-accent focus:w-32 disabled:opacity-50"
        />
      </form>
    </div>
  );
}
