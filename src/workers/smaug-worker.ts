import {
  fetchRecentLikes,
  fetchRecentBookmarks,
  type NormalizedSource,
  type FetchRecentLikesResult,
  type FetchRecentBookmarksResult,
} from '@/lib/smaug/client';
import { createSource, sourceExists } from '@/db/models/sources';
import {
  checkSourceDuplicateHybrid,
  addSourceToQdrant,
  SOURCE_SIMILARITY_THRESHOLD,
} from '@/lib/sources/deduplication';
import type { Source } from '@/types';

function logInfo(message: string, data?: Record<string, unknown>): void {
  const timestamp = new Date().toISOString();
  const logData = data ? ` ${JSON.stringify(data)}` : '';
  // eslint-disable-next-line no-console
  console.log(`[${timestamp}] [smaug-worker] INFO: ${message}${logData}`);
}

function logError(message: string, error?: unknown, data?: Record<string, unknown>): void {
  const timestamp = new Date().toISOString();
  const errorMsg = error instanceof Error ? error.message : String(error ?? '');
  const logData = data ? ` ${JSON.stringify(data)}` : '';
  const errorSuffix = errorMsg ? `: ${errorMsg}` : '';
  console.error(`[${timestamp}] [smaug-worker] ERROR: ${message}${errorSuffix}${logData}`);
}

export interface SmaugWorkerConfig {
  pollIntervalMs: number;
  maxResultsPerPoll: number;
  enabled: boolean;
}

export interface SmaugPollResult {
  likesProcessed: number;
  bookmarksProcessed: number;
  likesDuplicate: number;
  bookmarksDuplicate: number;
  likesSemanticDuplicate: number;
  bookmarksSemanticDuplicate: number;
  errors: SmaugPollError[];
  duration: number;
}

export interface SmaugPollError {
  type: 'likes' | 'bookmarks' | 'insert';
  message: string;
  sourceId?: string;
}

const DEFAULT_CONFIG: SmaugWorkerConfig = {
  pollIntervalMs: 5 * 60 * 1000,
  maxResultsPerPoll: 100,
  enabled: true,
};

let workerConfig: SmaugWorkerConfig = { ...DEFAULT_CONFIG };
let pollTimer: NodeJS.Timeout | null = null;
let isPolling = false;
let shutdownRequested = false;
let completionResolvers: Array<() => void> = [];

export function getSmaugWorkerConfig(): SmaugWorkerConfig {
  return { ...workerConfig };
}

export function configureSmaugWorker(config: Partial<SmaugWorkerConfig>): void {
  workerConfig = { ...workerConfig, ...config };
}

export function resetSmaugWorkerConfig(): void {
  workerConfig = { ...DEFAULT_CONFIG };
}

interface InsertWithDedupResult {
  inserted: boolean;
  source?: Source;
  isSemanticDuplicate?: boolean;
  semanticMatch?: { sourceId: string; similarity: number };
}

async function insertSourceWithDedup(normalized: NormalizedSource): Promise<InsertWithDedupResult> {
  if (sourceExists(normalized.sourceType, normalized.sourceId)) {
    return { inserted: false };
  }

  const hybridResult = await checkSourceDuplicateHybrid(normalized.content, {
    threshold: SOURCE_SIMILARITY_THRESHOLD,
    maxResults: 1,
    excludeSourceId: normalized.sourceId,
  });

  if (hybridResult.isDuplicate && hybridResult.matches.length > 0) {
    logInfo('Semantic duplicate found', {
      sourceId: normalized.sourceId,
      matchSourceId: hybridResult.matches[0].sourceId,
      similarity: hybridResult.matches[0].similarity,
    });
    return {
      inserted: false,
      isSemanticDuplicate: true,
      semanticMatch: {
        sourceId: hybridResult.matches[0].sourceId,
        similarity: hybridResult.matches[0].similarity,
      },
    };
  }

  const source = createSource({
    sourceType: normalized.sourceType,
    sourceId: normalized.sourceId,
    content: normalized.content,
    metadata: normalized.metadata,
  });

  try {
    await addSourceToQdrant(
      normalized.sourceId,
      normalized.content,
      normalized.sourceType,
      normalized.metadata
    );
  } catch (qdrantError) {
    logError('Failed to add source to Qdrant', qdrantError, { sourceId: normalized.sourceId });
  }

  return { inserted: true, source };
}

export async function pollSmaugData(): Promise<SmaugPollResult> {
  const startTime = Date.now();
  const errors: SmaugPollError[] = [];
  let likesProcessed = 0;
  let likesDuplicate = 0;
  let likesSemanticDuplicate = 0;
  let bookmarksProcessed = 0;
  let bookmarksDuplicate = 0;
  let bookmarksSemanticDuplicate = 0;

  logInfo('Starting Smaug poll', { maxResults: workerConfig.maxResultsPerPoll });

  let likesResult: FetchRecentLikesResult | null = null;
  try {
    likesResult = await fetchRecentLikes({ maxResults: workerConfig.maxResultsPerPoll });
    logInfo('Fetched likes', { count: likesResult.totalFetched, hasMore: likesResult.hasMore });
  } catch (error) {
    logError('Failed to fetch likes', error);
    errors.push({
      type: 'likes',
      message: error instanceof Error ? error.message : 'Unknown error fetching likes',
    });
  }

  if (likesResult) {
    for (const normalized of likesResult.likes) {
      try {
        const result = await insertSourceWithDedup(normalized);
        if (result.inserted) {
          likesProcessed++;
        } else if (result.isSemanticDuplicate === true) {
          likesSemanticDuplicate++;
        } else {
          likesDuplicate++;
        }
      } catch (error) {
        logError('Failed to insert like', error, { sourceId: normalized.sourceId });
        errors.push({
          type: 'insert',
          message: error instanceof Error ? error.message : 'Unknown error inserting like',
          sourceId: normalized.sourceId,
        });
      }
    }
  }

  let bookmarksResult: FetchRecentBookmarksResult | null = null;
  try {
    bookmarksResult = await fetchRecentBookmarks({ maxResults: workerConfig.maxResultsPerPoll });
    logInfo('Fetched bookmarks', {
      count: bookmarksResult.totalFetched,
      hasMore: bookmarksResult.hasMore,
    });
  } catch (error) {
    logError('Failed to fetch bookmarks', error);
    errors.push({
      type: 'bookmarks',
      message: error instanceof Error ? error.message : 'Unknown error fetching bookmarks',
    });
  }

  if (bookmarksResult) {
    for (const normalized of bookmarksResult.bookmarks) {
      try {
        const result = await insertSourceWithDedup(normalized);
        if (result.inserted) {
          bookmarksProcessed++;
        } else if (result.isSemanticDuplicate === true) {
          bookmarksSemanticDuplicate++;
        } else {
          bookmarksDuplicate++;
        }
      } catch (error) {
        logError('Failed to insert bookmark', error, { sourceId: normalized.sourceId });
        errors.push({
          type: 'insert',
          message: error instanceof Error ? error.message : 'Unknown error inserting bookmark',
          sourceId: normalized.sourceId,
        });
      }
    }
  }

  const duration = Date.now() - startTime;
  const result: SmaugPollResult = {
    likesProcessed,
    bookmarksProcessed,
    likesDuplicate,
    bookmarksDuplicate,
    likesSemanticDuplicate,
    bookmarksSemanticDuplicate,
    errors,
    duration,
  };

  logInfo('Smaug poll completed', {
    likesProcessed,
    bookmarksProcessed,
    likesDuplicate,
    bookmarksDuplicate,
    likesSemanticDuplicate,
    bookmarksSemanticDuplicate,
    errorCount: errors.length,
    durationMs: duration,
  });

  if (errors.length > 0) {
    logError('Smaug poll completed with errors', undefined, {
      errors: errors.map((e) => ({ type: e.type, message: e.message, sourceId: e.sourceId })),
    });
  }

  return result;
}

export function startSmaugWorker(onPoll?: (result: SmaugPollResult) => void): void {
  if (pollTimer !== null) {
    logInfo('Worker already running, skipping start');
    return;
  }

  if (!workerConfig.enabled) {
    logInfo('Worker disabled, skipping start');
    return;
  }

  logInfo('Starting Smaug worker', { pollIntervalMs: workerConfig.pollIntervalMs });
  shutdownRequested = false;

  const runPoll = async (): Promise<void> => {
    if (isPolling || shutdownRequested) return;
    isPolling = true;

    try {
      const result = await pollSmaugData();
      onPoll?.(result);
    } finally {
      isPolling = false;
      if (shutdownRequested) {
        for (const resolve of completionResolvers) {
          resolve();
        }
        completionResolvers = [];
      }
    }
  };

  void runPoll();

  pollTimer = setInterval(() => {
    void runPoll();
  }, workerConfig.pollIntervalMs);
}

export function stopSmaugWorker(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
    shutdownRequested = true;
    logInfo('Smaug worker stopped');
  }
}

export function awaitSmaugWorkerCompletion(): Promise<void> {
  if (!isPolling) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    completionResolvers.push(resolve);
  });
}

export function isSmaugWorkerRunning(): boolean {
  return pollTimer !== null;
}

export function isSmaugWorkerPolling(): boolean {
  return isPolling;
}
