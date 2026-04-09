/**
 * Server-side clipboard utilities (uses database)
 *
 * NOTE: For client components, import from '@/lib/copy/clipboard-client' instead
 * to avoid Node.js module errors in the browser.
 */

import { getDb } from '@/db/connection';

// Re-export client-safe functions for backward compatibility
export {
  parseThreadContent,
  formatThreadForCopy,
  isThread,
  copyToClipboard,
  copyPostContent,
  copyThreadTweet,
  copyAllThreadTweets,
  formatCopiedAt,
  type CopyResult,
  type ThreadTweet,
} from './clipboard-client';

export function recordCopy(postId: number): void {
  const db = getDb();
  const stmt = db.prepare(`UPDATE posts SET copied_at = datetime('now') WHERE id = ?`);
  stmt.run(postId);
}

export function getCopiedAt(postId: number): string | null {
  const db = getDb();
  const stmt = db.prepare(`SELECT copied_at FROM posts WHERE id = ?`);
  const row = stmt.get(postId) as { copied_at: string | null } | undefined;
  return row?.copied_at ?? null;
}

export function getPostsCopiedCount(): number {
  const db = getDb();
  const stmt = db.prepare(`SELECT COUNT(*) as count FROM posts WHERE copied_at IS NOT NULL`);
  const row = stmt.get() as { count: number };
  return row.count;
}
