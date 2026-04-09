import type { SourceType, SourceMetadata } from '@/types';

export interface SmaugConfig {
  apiUrl: string;
  apiKey?: string;
}

let config: SmaugConfig | null = null;

export function getSmaugConfig(): SmaugConfig {
  if (!config) {
    const apiUrl = process.env.SMAUG_API_URL;
    if (!apiUrl) {
      throw new Error('SMAUG_API_URL environment variable is required');
    }
    config = {
      apiUrl: apiUrl.replace(/\/$/, ''),
      apiKey: process.env.SMAUG_API_KEY ?? undefined,
    };
  }
  return config;
}

export function resetSmaugConfig(): void {
  config = null;
}

export interface SmaugTweet {
  id: string;
  text: string;
  authorHandle: string;
  authorName: string;
  likeCount: number;
  retweetCount: number;
  url: string;
  createdAt: string;
}

export interface SmaugLikesResponse {
  likes: SmaugTweet[];
  cursor?: string;
  hasMore: boolean;
}

export interface SmaugBookmarksResponse {
  bookmarks: SmaugTweet[];
  cursor?: string;
  hasMore: boolean;
}

export interface FetchLikesOptions {
  limit?: number;
  cursor?: string;
  since?: string;
}

export interface FetchBookmarksOptions {
  limit?: number;
  cursor?: string;
  since?: string;
}

export interface NormalizedSource {
  sourceType: SourceType;
  sourceId: string;
  content: string;
  metadata: SourceMetadata;
}

async function fetchFromSmaug<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
  const { apiUrl, apiKey } = getSmaugConfig();

  const url = new URL(`${apiUrl}${endpoint}`);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== '') {
        url.searchParams.set(key, value);
      }
    });
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new SmaugError(
      `Smaug API error: ${response.status} ${response.statusText}`,
      response.status,
      errorText
    );
  }

  return response.json() as Promise<T>;
}

export class SmaugError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly responseBody?: string
  ) {
    super(message);
    this.name = 'SmaugError';
  }
}

export async function fetchLikes(options: FetchLikesOptions = {}): Promise<SmaugLikesResponse> {
  const params: Record<string, string> = {};
  if (options.limit !== undefined && options.limit > 0) {
    params['limit'] = options.limit.toString();
  }
  if (options.cursor) params['cursor'] = options.cursor;
  if (options.since) params['since'] = options.since;

  return fetchFromSmaug<SmaugLikesResponse>('/likes', params);
}

export async function fetchBookmarks(
  options: FetchBookmarksOptions = {}
): Promise<SmaugBookmarksResponse> {
  const params: Record<string, string> = {};
  if (options.limit !== undefined && options.limit > 0) {
    params['limit'] = options.limit.toString();
  }
  if (options.cursor) params['cursor'] = options.cursor;
  if (options.since) params['since'] = options.since;

  return fetchFromSmaug<SmaugBookmarksResponse>('/bookmarks', params);
}

export function normalizeSmaugTweet(
  tweet: SmaugTweet,
  sourceType: 'like' | 'bookmark'
): NormalizedSource {
  return {
    sourceType,
    sourceId: tweet.id,
    content: tweet.text,
    metadata: {
      authorHandle: tweet.authorHandle,
      authorName: tweet.authorName,
      likeCount: tweet.likeCount,
      retweetCount: tweet.retweetCount,
      url: tweet.url,
    },
  };
}

export interface FetchRecentLikesResult {
  likes: NormalizedSource[];
  totalFetched: number;
  hasMore: boolean;
  lastCursor?: string;
}

export async function fetchRecentLikes(
  options: FetchLikesOptions & { maxResults?: number } = {}
): Promise<FetchRecentLikesResult> {
  const { maxResults = 100, ...fetchOptions } = options;
  const allLikes: NormalizedSource[] = [];
  let cursor = fetchOptions.cursor;
  let hasMore = true;

  while (hasMore && allLikes.length < maxResults) {
    const remaining = maxResults - allLikes.length;
    const limit = Math.min(remaining, fetchOptions.limit ?? 50);

    const response = await fetchLikes({
      ...fetchOptions,
      limit,
      cursor,
    });

    for (const tweet of response.likes) {
      if (allLikes.length >= maxResults) break;
      allLikes.push(normalizeSmaugTweet(tweet, 'like'));
    }

    hasMore = response.hasMore;
    cursor = response.cursor;

    if (!response.likes.length) break;
  }

  return {
    likes: allLikes,
    totalFetched: allLikes.length,
    hasMore,
    lastCursor: cursor,
  };
}

export interface FetchRecentBookmarksResult {
  bookmarks: NormalizedSource[];
  totalFetched: number;
  hasMore: boolean;
  lastCursor?: string;
}

export async function fetchRecentBookmarks(
  options: FetchBookmarksOptions & { maxResults?: number } = {}
): Promise<FetchRecentBookmarksResult> {
  const { maxResults = 100, ...fetchOptions } = options;
  const allBookmarks: NormalizedSource[] = [];
  let cursor = fetchOptions.cursor;
  let hasMore = true;

  while (hasMore && allBookmarks.length < maxResults) {
    const remaining = maxResults - allBookmarks.length;
    const limit = Math.min(remaining, fetchOptions.limit ?? 50);

    const response = await fetchBookmarks({
      ...fetchOptions,
      limit,
      cursor,
    });

    for (const tweet of response.bookmarks) {
      if (allBookmarks.length >= maxResults) break;
      allBookmarks.push(normalizeSmaugTweet(tweet, 'bookmark'));
    }

    hasMore = response.hasMore;
    cursor = response.cursor;

    if (!response.bookmarks.length) break;
  }

  return {
    bookmarks: allBookmarks,
    totalFetched: allBookmarks.length,
    hasMore,
    lastCursor: cursor,
  };
}

export async function healthCheck(): Promise<boolean> {
  try {
    const { apiUrl, apiKey } = getSmaugConfig();

    const headers: Record<string, string> = {};
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetch(`${apiUrl}/health`, {
      method: 'GET',
      headers,
    });

    return response.ok;
  } catch {
    return false;
  }
}
