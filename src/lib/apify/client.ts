import type { SourceType, SourceMetadata } from '@/types';

export interface ApifyConfig {
  apiToken: string;
  actorId: string;
}

let config: ApifyConfig | null = null;

const APIFY_BASE_URL = 'https://api.apify.com/v2';
const DEFAULT_ACTOR_ID = 'quacker/twitter-scraper';

export function getApifyConfig(): ApifyConfig {
  if (!config) {
    const apiToken = process.env.APIFY_API_TOKEN;
    if (!apiToken) {
      throw new Error('APIFY_API_TOKEN environment variable is required');
    }
    config = {
      apiToken,
      actorId: process.env.APIFY_ACTOR_ID ?? DEFAULT_ACTOR_ID,
    };
  }
  return config;
}

export function resetApifyConfig(): void {
  config = null;
}

export interface ApifyTweet {
  id: string;
  text: string;
  author: {
    userName: string;
    displayName: string;
  };
  createdAt: string;
  likes: number;
  retweets: number;
  replies: number;
  url: string;
}

export interface ApifyRunInput {
  startUrls?: { url: string }[];
  handles?: string[];
  maxTweets?: number;
  tweetsDesired?: number;
}

export interface ApifyRunStatus {
  id: string;
  status: 'READY' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'ABORTING' | 'ABORTED' | 'TIMING-OUT';
  startedAt: string;
  finishedAt?: string;
  defaultDatasetId: string;
}

export interface ApifyDatasetResponse {
  items: ApifyTweet[];
  offset: number;
  limit: number;
  count: number;
  total: number;
}

export interface NormalizedSource {
  sourceType: SourceType;
  sourceId: string;
  content: string;
  metadata: SourceMetadata;
}

export class ApifyError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly responseBody?: string
  ) {
    super(message);
    this.name = 'ApifyError';
  }
}

async function fetchFromApify<T>(
  endpoint: string,
  options: {
    method?: 'GET' | 'POST';
    body?: ApifyRunInput;
  } = {}
): Promise<T> {
  const { apiToken } = getApifyConfig();
  const { method = 'GET', body } = options;

  const url = `${APIFY_BASE_URL}${endpoint}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiToken}`,
    'Content-Type': 'application/json',
  };

  const fetchOptions: RequestInit = {
    method,
    headers,
  };

  if (body && method === 'POST') {
    fetchOptions.body = JSON.stringify(body);
  }

  const response = await fetch(url, fetchOptions);

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new ApifyError(
      `Apify API error: ${response.status} ${response.statusText}`,
      response.status,
      errorText
    );
  }

  return response.json() as Promise<T>;
}

export async function startActorRun(input: ApifyRunInput): Promise<ApifyRunStatus> {
  const { actorId } = getApifyConfig();

  const response = await fetchFromApify<{ data: ApifyRunStatus }>(
    `/acts/${encodeURIComponent(actorId)}/runs`,
    {
      method: 'POST',
      body: input,
    }
  );

  return response.data;
}

export async function getRunStatus(runId: string): Promise<ApifyRunStatus> {
  const { actorId } = getApifyConfig();

  const response = await fetchFromApify<{ data: ApifyRunStatus }>(
    `/acts/${encodeURIComponent(actorId)}/runs/${runId}`
  );

  return response.data;
}

export async function waitForRunCompletion(
  runId: string,
  options: {
    pollIntervalMs?: number;
    timeoutMs?: number;
  } = {}
): Promise<ApifyRunStatus> {
  const { pollIntervalMs = 5000, timeoutMs = 600000 } = options;
  const startTime = Date.now();

  let isPolling = true;
  while (isPolling) {
    const status = await getRunStatus(runId);

    if (
      status.status === 'SUCCEEDED' ||
      status.status === 'FAILED' ||
      status.status === 'ABORTED'
    ) {
      return status;
    }

    if (Date.now() - startTime > timeoutMs) {
      isPolling = false;
      throw new ApifyError(`Apify run ${runId} timed out after ${timeoutMs}ms`, 408);
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new ApifyError(`Apify run ${runId} polling ended unexpectedly`, 500);
}

export async function getRunDataset(
  datasetId: string,
  options: {
    offset?: number;
    limit?: number;
  } = {}
): Promise<ApifyDatasetResponse> {
  const { offset = 0, limit = 100 } = options;

  const items = await fetchFromApify<ApifyTweet[]>(
    `/datasets/${datasetId}/items?offset=${offset}&limit=${limit}`
  );

  return {
    items,
    offset,
    limit,
    count: items.length,
    total: items.length,
  };
}

export function normalizeApifyTweet(tweet: ApifyTweet): NormalizedSource {
  return {
    sourceType: 'account_tweet',
    sourceId: tweet.id,
    content: tweet.text,
    metadata: {
      authorHandle: tweet.author.userName,
      authorName: tweet.author.displayName,
      likeCount: tweet.likes,
      retweetCount: tweet.retweets,
      url: tweet.url,
    },
  };
}

export interface ScrapeAccountOptions {
  maxTweets?: number;
  waitForCompletion?: boolean;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

export interface ScrapeAccountResult {
  runId: string;
  status: ApifyRunStatus['status'];
  tweets: NormalizedSource[];
  totalFetched: number;
}

export async function scrapeAccount(
  handle: string,
  options: ScrapeAccountOptions = {}
): Promise<ScrapeAccountResult> {
  const {
    maxTweets = 50,
    waitForCompletion = true,
    pollIntervalMs = 5000,
    timeoutMs = 600000,
  } = options;

  const normalizedHandle = handle.startsWith('@') ? handle.slice(1) : handle;

  const run = await startActorRun({
    handles: [normalizedHandle],
    maxTweets,
    tweetsDesired: maxTweets,
  });

  if (!waitForCompletion) {
    return {
      runId: run.id,
      status: run.status,
      tweets: [],
      totalFetched: 0,
    };
  }

  const completedRun = await waitForRunCompletion(run.id, {
    pollIntervalMs,
    timeoutMs,
  });

  if (completedRun.status !== 'SUCCEEDED') {
    return {
      runId: completedRun.id,
      status: completedRun.status,
      tweets: [],
      totalFetched: 0,
    };
  }

  const tweets: NormalizedSource[] = [];
  let offset = 0;
  const limit = 100;
  let hasMore = true;

  while (hasMore) {
    const dataset = await getRunDataset(completedRun.defaultDatasetId, { offset, limit });
    const normalized = dataset.items.map(normalizeApifyTweet);
    tweets.push(...normalized);

    if (dataset.count < limit) {
      hasMore = false;
    } else {
      offset += limit;
    }
  }

  return {
    runId: completedRun.id,
    status: completedRun.status,
    tweets,
    totalFetched: tweets.length,
  };
}

export interface BatchScrapeOptions {
  maxTweetsPerAccount?: number;
  concurrency?: number;
  pollIntervalMs?: number;
  timeoutMs?: number;
  onAccountComplete?: (handle: string, result: BatchAccountResult) => void;
}

export interface BatchAccountResult {
  handle: string;
  success: boolean;
  tweets: NormalizedSource[];
  totalFetched: number;
  error?: string;
}

export interface BatchScrapeResult {
  results: BatchAccountResult[];
  totalAccounts: number;
  successfulAccounts: number;
  failedAccounts: number;
  totalTweets: number;
}

export async function batchScrapeAccounts(
  handles: string[],
  options: BatchScrapeOptions = {}
): Promise<BatchScrapeResult> {
  const {
    maxTweetsPerAccount = 50,
    concurrency = 3,
    pollIntervalMs = 5000,
    timeoutMs = 600000,
    onAccountComplete,
  } = options;

  const results: BatchAccountResult[] = [];
  const normalizedHandles = handles.map((h) => (h.startsWith('@') ? h.slice(1) : h));

  const processAccount = async (handle: string): Promise<BatchAccountResult> => {
    try {
      const scrapeResult = await scrapeAccount(handle, {
        maxTweets: maxTweetsPerAccount,
        waitForCompletion: true,
        pollIntervalMs,
        timeoutMs,
      });

      const result: BatchAccountResult = {
        handle,
        success: scrapeResult.status === 'SUCCEEDED',
        tweets: scrapeResult.tweets,
        totalFetched: scrapeResult.totalFetched,
        error:
          scrapeResult.status !== 'SUCCEEDED' ? `Run status: ${scrapeResult.status}` : undefined,
      };

      if (onAccountComplete) {
        onAccountComplete(handle, result);
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const result: BatchAccountResult = {
        handle,
        success: false,
        tweets: [],
        totalFetched: 0,
        error: errorMessage,
      };

      if (onAccountComplete) {
        onAccountComplete(handle, result);
      }

      return result;
    }
  };

  for (let i = 0; i < normalizedHandles.length; i += concurrency) {
    const batch = normalizedHandles.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(processAccount));
    results.push(...batchResults);
  }

  const successfulAccounts = results.filter((r) => r.success).length;
  const totalTweets = results.reduce((sum, r) => sum + r.totalFetched, 0);

  return {
    results,
    totalAccounts: handles.length,
    successfulAccounts,
    failedAccounts: handles.length - successfulAccounts,
    totalTweets,
  };
}

export async function healthCheck(): Promise<boolean> {
  try {
    const { apiToken } = getApifyConfig();

    const response = await fetch(`${APIFY_BASE_URL}/users/me`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiToken}`,
      },
    });

    return response.ok;
  } catch {
    return false;
  }
}
