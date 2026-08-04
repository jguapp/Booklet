import type { StoredHighlight } from "./highlight-store";

export interface ImportRequest {
  type: "booklet-import-page";
  url: string;
  highlights: StoredHighlight[];
}

export type ImportResponse =
  | { ok: true; articleId: string; importedCount: number }
  | { ok: false; error: "not_signed_in" | "save_failed" | "highlights_failed"; message: string };

export function isImportRequest(value: unknown): value is ImportRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as ImportRequest).type === "booklet-import-page" &&
    typeof (value as ImportRequest).url === "string"
  );
}
