import {
  getNextInQueue,
  deleteQueueItem,
  listQueue,
  countQueue,
  type ListQueueOptions,
} from '@/db/models/queue';
import { getPostById, updatePost } from '@/db/models/posts';
import { QueueItem, Post, PostStatus } from '@/types';

function logInfo(message: string, data?: Record<string, unknown>): void {
  const timestamp = new Date().toISOString();
  const logData = data ? ` ${JSON.stringify(data)}` : '';
  // eslint-disable-next-line no-console
  console.log(`[${timestamp}] [job-queue] INFO: ${message}${logData}`);
}

function logError(message: string, error?: unknown, data?: Record<string, unknown>): void {
  const timestamp = new Date().toISOString();
  const errorMsg = error instanceof Error ? error.message : String(error ?? '');
  const logData = data ? ` ${JSON.stringify(data)}` : '';
  const errorSuffix = errorMsg ? `: ${errorMsg}` : '';
  console.error(`[${timestamp}] [job-queue] ERROR: ${message}${errorSuffix}${logData}`);
}

function logWarn(message: string, data?: Record<string, unknown>): void {
  const timestamp = new Date().toISOString();
  const logData = data ? ` ${JSON.stringify(data)}` : '';
  console.warn(`[${timestamp}] [job-queue] WARN: ${message}${logData}`);
}

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'skipped';

export interface JobResult {
  queueItemId: number;
  postId: number;
  status: JobStatus;
  processedAt: string;
  durationMs: number;
  error?: string;
  newPostStatus?: PostStatus;
}

export interface JobProcessorConfig {
  pollIntervalMs: number;
  maxRetries: number;
  retryDelayMs: number;
  batchSize: number;
  enabled: boolean;
  concurrency: number;
}

export interface ProcessorStats {
  totalProcessed: number;
  successful: number;
  failed: number;
  skipped: number;
  averageDurationMs: number;
  lastProcessedAt: string | null;
}

export type JobHandler = (post: Post, queueItem: QueueItem) => Promise<PostStatus | null>;
export type JobResultCallback = (result: JobResult) => void;

const DEFAULT_CONFIG: JobProcessorConfig = {
  pollIntervalMs: 10000,
  maxRetries: 3,
  retryDelayMs: 1000,
  batchSize: 5,
  enabled: true,
  concurrency: 1,
};

let processorConfig: JobProcessorConfig = { ...DEFAULT_CONFIG };
let processorTimer: ReturnType<typeof setInterval> | null = null;
let isProcessing = false;
let jobHandler: JobHandler | null = null;
let resultCallback: JobResultCallback | null = null;

const stats: ProcessorStats = {
  totalProcessed: 0,
  successful: 0,
  failed: 0,
  skipped: 0,
  averageDurationMs: 0,
  lastProcessedAt: null,
};
const durationHistory: number[] = [];
const MAX_DURATION_HISTORY = 100;

export function getJobProcessorConfig(): JobProcessorConfig {
  return { ...processorConfig };
}

export function configureJobProcessor(config: Partial<JobProcessorConfig>): void {
  processorConfig = { ...processorConfig, ...config };
}

export function resetJobProcessorConfig(): void {
  processorConfig = { ...DEFAULT_CONFIG };
}

export function getProcessorStats(): ProcessorStats {
  return { ...stats };
}

export function resetProcessorStats(): void {
  stats.totalProcessed = 0;
  stats.successful = 0;
  stats.failed = 0;
  stats.skipped = 0;
  stats.averageDurationMs = 0;
  stats.lastProcessedAt = null;
  durationHistory.length = 0;
}

function updateAverageDuration(durationMs: number): void {
  durationHistory.push(durationMs);
  if (durationHistory.length > MAX_DURATION_HISTORY) {
    durationHistory.shift();
  }
  stats.averageDurationMs = Math.round(
    durationHistory.reduce((a, b) => a + b, 0) / durationHistory.length
  );
}

async function processJob(queueItem: QueueItem): Promise<JobResult> {
  const startTime = Date.now();
  const result: JobResult = {
    queueItemId: queueItem.id,
    postId: queueItem.postId,
    status: 'processing',
    processedAt: new Date().toISOString(),
    durationMs: 0,
  };

  try {
    const post = getPostById(queueItem.postId);
    if (!post) {
      logWarn('Post not found for queue item, removing from queue', {
        queueItemId: queueItem.id,
        postId: queueItem.postId,
      });
      deleteQueueItem(queueItem.id);
      result.status = 'skipped';
      result.error = 'Post not found';
      stats.skipped++;
      return result;
    }

    if (post.status !== 'draft' && post.status !== 'pending') {
      logInfo('Post already processed, removing from queue', {
        queueItemId: queueItem.id,
        postId: queueItem.postId,
        postStatus: post.status,
      });
      deleteQueueItem(queueItem.id);
      result.status = 'skipped';
      result.error = `Post status is ${post.status}`;
      stats.skipped++;
      return result;
    }

    if (!jobHandler) {
      logWarn('No job handler configured, skipping', { queueItemId: queueItem.id });
      result.status = 'skipped';
      result.error = 'No job handler configured';
      stats.skipped++;
      return result;
    }

    const newStatus = await jobHandler(post, queueItem);

    if (newStatus) {
      updatePost(post.id, { status: newStatus });
      result.newPostStatus = newStatus;
      logInfo('Post status updated', {
        postId: post.id,
        oldStatus: post.status,
        newStatus,
      });
    }

    deleteQueueItem(queueItem.id);
    result.status = 'completed';
    stats.successful++;
    logInfo('Job completed successfully', {
      queueItemId: queueItem.id,
      postId: queueItem.postId,
    });
  } catch (error) {
    result.status = 'failed';
    result.error = error instanceof Error ? error.message : String(error);
    stats.failed++;
    logError('Job processing failed', error, {
      queueItemId: queueItem.id,
      postId: queueItem.postId,
    });
  }

  result.durationMs = Date.now() - startTime;
  stats.totalProcessed++;
  stats.lastProcessedAt = result.processedAt;
  updateAverageDuration(result.durationMs);

  return result;
}

async function processJobWithRetry(queueItem: QueueItem): Promise<JobResult> {
  let lastResult: JobResult | null = null;
  let attempt = 0;

  while (attempt < processorConfig.maxRetries) {
    attempt++;
    lastResult = await processJob(queueItem);

    if (lastResult.status !== 'failed') {
      return lastResult;
    }

    if (attempt < processorConfig.maxRetries) {
      logWarn('Job failed, retrying', {
        queueItemId: queueItem.id,
        attempt,
        maxRetries: processorConfig.maxRetries,
        error: lastResult.error,
      });
      await new Promise((resolve) => setTimeout(resolve, processorConfig.retryDelayMs));
    }
  }

  logError('Job failed after all retries', undefined, {
    queueItemId: queueItem.id,
    attempts: attempt,
  });

  // lastResult is guaranteed to be set since we always run at least once (maxRetries >= 1)
  return lastResult as JobResult;
}

export async function processBatch(): Promise<JobResult[]> {
  if (isProcessing) {
    logWarn('Already processing, skipping batch');
    return [];
  }

  isProcessing = true;
  const results: JobResult[] = [];

  try {
    const queueItems = listQueue({
      limit: processorConfig.batchSize,
      scheduledBefore: new Date().toISOString(),
      orderBy: 'priority',
      orderDir: 'desc',
    });

    if (queueItems.length === 0) {
      return results;
    }

    logInfo('Processing batch', { count: queueItems.length });

    for (const queueItem of queueItems) {
      const result = await processJobWithRetry(queueItem);
      results.push(result);

      if (resultCallback) {
        resultCallback(result);
      }
    }

    logInfo('Batch completed', {
      total: results.length,
      successful: results.filter((r) => r.status === 'completed').length,
      failed: results.filter((r) => r.status === 'failed').length,
      skipped: results.filter((r) => r.status === 'skipped').length,
    });
  } finally {
    isProcessing = false;
  }

  return results;
}

export async function processNext(): Promise<JobResult | null> {
  if (isProcessing) {
    return null;
  }

  isProcessing = true;

  try {
    const queueItem = getNextInQueue();
    if (!queueItem) {
      return null;
    }

    const result = await processJobWithRetry(queueItem);

    if (resultCallback) {
      resultCallback(result);
    }

    return result;
  } finally {
    isProcessing = false;
  }
}

async function poll(): Promise<void> {
  if (!processorConfig.enabled) {
    return;
  }

  try {
    await processBatch();
  } catch (error) {
    logError('Error during poll cycle', error);
  }
}

export function startJobProcessor(handler: JobHandler, onResult?: JobResultCallback): void {
  if (processorTimer !== null) {
    logWarn('Job processor already running, skipping start');
    return;
  }

  jobHandler = handler;
  resultCallback = onResult ?? null;

  logInfo('Starting job queue processor', {
    pollIntervalMs: processorConfig.pollIntervalMs,
    batchSize: processorConfig.batchSize,
    maxRetries: processorConfig.maxRetries,
  });

  void poll();
  processorTimer = setInterval(() => void poll(), processorConfig.pollIntervalMs);

  logInfo('Job queue processor started');
}

export function stopJobProcessor(): void {
  if (processorTimer === null) {
    logWarn('Job processor not running, skipping stop');
    return;
  }

  clearInterval(processorTimer);
  processorTimer = null;
  jobHandler = null;
  resultCallback = null;

  logInfo('Job queue processor stopped');
}

export function isJobProcessorRunning(): boolean {
  return processorTimer !== null;
}

export function isJobProcessorBusy(): boolean {
  return isProcessing;
}

export function getQueueStatus(): {
  queueLength: number;
  isRunning: boolean;
  isProcessing: boolean;
  stats: ProcessorStats;
} {
  return {
    queueLength: countQueue(),
    isRunning: isJobProcessorRunning(),
    isProcessing: isJobProcessorBusy(),
    stats: getProcessorStats(),
  };
}

export async function drainQueue(handler: JobHandler): Promise<JobResult[]> {
  const results: JobResult[] = [];
  const originalHandler = jobHandler;
  jobHandler = handler;

  try {
    let queueItem = getNextInQueue();
    while (queueItem) {
      isProcessing = true;
      const result = await processJobWithRetry(queueItem);
      results.push(result);
      isProcessing = false;

      queueItem = getNextInQueue();
    }
  } finally {
    isProcessing = false;
    jobHandler = originalHandler;
  }

  return results;
}

export function peekQueue(options?: ListQueueOptions): QueueItem[] {
  return listQueue(options);
}
