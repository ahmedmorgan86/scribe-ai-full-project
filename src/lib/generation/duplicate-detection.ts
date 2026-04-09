import { getSimilarApprovedPosts, SimilarApprovedPost } from '@/lib/voice/embeddings';
import { listPosts } from '@/db/models/posts';
import type { Post, PostStatus } from '@/types';

export const DUPLICATE_SIMILARITY_THRESHOLD = 0.8;

export interface DuplicateMatch {
  content: string;
  similarity: number;
  source: 'approved_post' | 'pending_post' | 'draft_post';
  postId: number;
  createdAt?: string;
}

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  highestSimilarity: number;
  matches: DuplicateMatch[];
  warning: string | null;
}

export interface DuplicateCheckOptions {
  threshold?: number;
  checkApprovedPosts?: boolean;
  checkPendingPosts?: boolean;
  checkDraftPosts?: boolean;
  maxResults?: number;
}

const DEFAULT_OPTIONS: Required<DuplicateCheckOptions> = {
  threshold: DUPLICATE_SIMILARITY_THRESHOLD,
  checkApprovedPosts: true,
  checkPendingPosts: true,
  checkDraftPosts: false,
  maxResults: 5,
};

function calculateTextSimilarity(text1: string, text2: string): number {
  const normalize = (s: string): string =>
    s
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .trim();
  const a = normalize(text1);
  const b = normalize(text2);

  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const wordsA = new Set(a.split(/\s+/));
  const wordsB = new Set(b.split(/\s+/));

  let intersection = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) {
      intersection++;
    }
  }

  const union = wordsA.size + wordsB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function checkSqlitePosts(
  content: string,
  status: PostStatus,
  threshold: number,
  maxResults: number
): DuplicateMatch[] {
  const posts = listPosts({ status, limit: 100, orderBy: 'created_at', orderDir: 'desc' });
  const matches: DuplicateMatch[] = [];

  for (const post of posts) {
    const similarity = calculateTextSimilarity(content, post.content);
    if (similarity >= threshold) {
      matches.push({
        content: post.content,
        similarity,
        source: status === 'pending' ? 'pending_post' : 'draft_post',
        postId: post.id,
        createdAt: post.createdAt,
      });
    }
  }

  return matches.sort((a, b) => b.similarity - a.similarity).slice(0, maxResults);
}

async function checkApprovedPostsChroma(
  content: string,
  threshold: number,
  maxResults: number
): Promise<DuplicateMatch[]> {
  const similar = await getSimilarApprovedPosts(content, {
    nResults: maxResults,
    threshold,
  });

  return similar.map((p: SimilarApprovedPost) => ({
    content: p.content,
    similarity: p.similarity,
    source: 'approved_post' as const,
    postId: p.postId,
    createdAt: p.approvedAt,
  }));
}

export async function checkForDuplicates(
  content: string,
  options: DuplicateCheckOptions = {}
): Promise<DuplicateCheckResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const allMatches: DuplicateMatch[] = [];

  if (opts.checkApprovedPosts) {
    const approvedMatches = await checkApprovedPostsChroma(
      content,
      opts.threshold,
      opts.maxResults
    );
    allMatches.push(...approvedMatches);
  }

  if (opts.checkPendingPosts) {
    const pendingMatches = checkSqlitePosts(content, 'pending', opts.threshold, opts.maxResults);
    allMatches.push(...pendingMatches);
  }

  if (opts.checkDraftPosts) {
    const draftMatches = checkSqlitePosts(content, 'draft', opts.threshold, opts.maxResults);
    allMatches.push(...draftMatches);
  }

  const sortedMatches = allMatches
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, opts.maxResults);

  const highestSimilarity = sortedMatches.length > 0 ? sortedMatches[0].similarity : 0;
  const isDuplicate = highestSimilarity >= opts.threshold;

  let warning: string | null = null;
  if (isDuplicate) {
    const topMatch = sortedMatches[0];
    const percentSimilar = Math.round(topMatch.similarity * 100);
    warning = `Content is ${percentSimilar}% similar to existing ${topMatch.source.replace('_', ' ')} (ID: ${topMatch.postId})`;
  }

  return {
    isDuplicate,
    highestSimilarity,
    matches: sortedMatches,
    warning,
  };
}

export function formatDuplicateCheckResult(result: DuplicateCheckResult): string {
  const lines: string[] = [];

  lines.push('=== DUPLICATE CHECK ===');
  lines.push(`Is Duplicate: ${result.isDuplicate}`);
  lines.push(`Highest Similarity: ${Math.round(result.highestSimilarity * 100)}%`);

  if (result.warning) {
    lines.push(`Warning: ${result.warning}`);
  }

  if (result.matches.length > 0) {
    lines.push('');
    lines.push('Matches:');
    for (const match of result.matches) {
      const percent = Math.round(match.similarity * 100);
      const preview =
        match.content.length > 50 ? match.content.slice(0, 50) + '...' : match.content;
      lines.push(`  [${percent}%] ${match.source} #${match.postId}: "${preview}"`);
    }
  }

  return lines.join('\n');
}

export function quickDuplicateCheck(content: string, existingPosts: Post[]): DuplicateMatch | null {
  for (const post of existingPosts) {
    const similarity = calculateTextSimilarity(content, post.content);
    if (similarity >= DUPLICATE_SIMILARITY_THRESHOLD) {
      return {
        content: post.content,
        similarity,
        source:
          post.status === 'approved'
            ? 'approved_post'
            : post.status === 'pending'
              ? 'pending_post'
              : 'draft_post',
        postId: post.id,
        createdAt: post.createdAt,
      };
    }
  }
  return null;
}
