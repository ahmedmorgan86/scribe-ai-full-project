/**
 * Client-safe clipboard utilities
 * These functions can be used in 'use client' components
 */

import { Post, PostType } from '@/types';

export interface CopyResult {
  success: boolean;
  error?: string;
}

export interface ThreadTweet {
  position: number;
  content: string;
}

export function parseThreadContent(content: string): ThreadTweet[] {
  const parts = content.split(/---+/).filter((part) => part.trim());

  if (parts.length <= 1) {
    const lines = content.split(/\n\n+/).filter((line) => line.trim());
    if (lines.length > 1) {
      return lines.map((line, index) => ({
        position: index + 1,
        content: line.trim(),
      }));
    }
    return [{ position: 1, content: content.trim() }];
  }

  return parts.map((part, index) => ({
    position: index + 1,
    content: part.trim(),
  }));
}

export function formatThreadForCopy(tweets: ThreadTweet[]): string {
  return tweets.map((tweet) => tweet.content).join('\n\n---\n\n');
}

export function isThread(type: PostType): boolean {
  return type === 'thread';
}

export async function copyToClipboard(text: string): Promise<CopyResult> {
  if (
    typeof window === 'undefined' ||
    typeof navigator === 'undefined' ||
    !('clipboard' in navigator)
  ) {
    return { success: false, error: 'Clipboard API not available' };
  }

  try {
    await navigator.clipboard.writeText(text);
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to copy';
    return { success: false, error: message };
  }
}

export async function copyPostContent(post: Post): Promise<CopyResult> {
  return copyToClipboard(post.content);
}

export async function copyThreadTweet(tweet: ThreadTweet): Promise<CopyResult> {
  return copyToClipboard(tweet.content);
}

export async function copyAllThreadTweets(tweets: ThreadTweet[]): Promise<CopyResult> {
  const formatted = formatThreadForCopy(tweets);
  return copyToClipboard(formatted);
}

export function formatCopiedAt(copiedAt: string | null): string {
  if (!copiedAt) {
    return 'Not copied';
  }

  const date = new Date(copiedAt);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMinutes < 1) {
    return 'Just now';
  }
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }

  return date.toLocaleDateString();
}
