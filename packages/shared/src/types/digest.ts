import type { Highlight } from "./highlight";

export interface Digest {
  id: string;
  userId: string;
  generatedAt: string;
  viewedAt: string | null;
  emailSentAt: string | null;
  highlights?: Highlight[]; // present when expanded (e.g. Daily Review page)
}
