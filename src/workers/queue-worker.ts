import {
  listQueue,
  deleteQueueItem,
  updateQueueItem,
  countQueue,
  createQueueItem,
  getQueueItemByPostId,
} from '@/db/models/queue';
import { getPostById, listPosts, countPosts } from '@/db/models/posts';
import type { Post } from '@/types';

function logInfo(message: string, data?: Record<string, unknown>): void {
  const timestamp = new Date().toISOString();
  const logData = data ? ` ${JSON.stringify(data)}` : '';
  // eslint-disable-next-line no-console
  console.log(`[${timestamp}] [queue-worker] INFO: ${message}${logData}`);
}

function logError(message: string, error?: unknown, data?: Record<string, unknown>): void {
  const timestamp = new Date().toISOString();
  const errorMsg = error instanceof Error ? error.message : String(error ?? '');
  const logData = data ? ` ${JSON.stringify(data)}` : '';
  const errorSuffix = errorMsg ? `: ${errorMsg}` : '';
  console.error(`[${timestamp}] [queue-worker] ERROR: ${message}${errorSuffix}${logData}`);
}

function logWarn(message: string, data?: Record<string, unknown>): void {
  const timestamp = new Date().toISOString();
  const logData = data ? ` ${JSON.stringify(data)}` : '';
  console.warn(`[${timestamp}] [queue-worker] WARN: ${message}${logData}`);
}

export interface QueueWorkerConfig {
  processIntervalMs: number;
  maxQueueSize: number;
  staleThresholdHours: number;
  enabled: boolean;
}

export interface QueueProcessResult {
  orphanedRemoved: number;
  staleRemoved: number;
  pendingPostsQueued: number;
  prioritiesUpdated: number;
  errors: QueueProcessError[];
  duration: number;
}

export interface QueueProcessError {
  type: 'orphan_cleanup' | 'stale_cleanup' | 'scheduling' | 'priority_update';
  message: string;
  itemId?: number;
  postId?: number;
}

const DEFAULT_CONFIG: QueueWorkerConfig = {
  processIntervalMs: 10 * 60 * 1000, // 10 minutes
  maxQueueSize: 100,
  staleThresholdHours: 72, // 3 days
  enabled: true,
};

let workerConfig: QueueWorkerConfig = { ...DEFAULT_CONFIG };
let processTimer: NodeJS.Timeout | null = null;
let isProcessing = false;
let shutdownRequested = false;
let completionResolvers: Array<() => void> = [];

export function getQueueWorkerConfig(): QueueWorkerConfig {
  return { ...workerConfig };
}

export function configureQueueWorker(config: Partial<QueueWorkerConfig>): void {
  workerConfig = { ...workerConfig, ...config };
}

export function resetQueueWorkerConfig(): void {
  workerConfig = { ...DEFAULT_CONFIG };
}

function removeOrphanedQueueItems(): { removed: number; errors: QueueProcessError[] } {
  const errors: QueueProcessError[] = [];
  let removed = 0;

  const queueItems = listQueue({ limit: 1000 });

  for (const item of queueItems) {
    try {
      const post = getPostById(item.postId);
      if (!post) {
        deleteQueueItem(item.id);
        removed++;
        logInfo('Removed orphaned queue item', { queueItemId: item.id, postId: item.postId });
      }
    } catch (error) {
      logError('Failed to check/remove orphaned queue item', error, { queueItemId: item.id });
      errors.push({
        type: 'orphan_cleanup',
        message: error instanceof Error ? error.message : 'Unknown error',
        itemId: item.id,
        postId: item.postId,
      });
    }
  }

  return { removed, errors };
}

function removeStaleQueueItems(thresholdHours: number): {
  removed: number;
  errors: QueueProcessError[];
} {
  const errors: QueueProcessError[] = [];
  let removed = 0;

  const thresholdDate = new Date();
  thresholdDate.setHours(thresholdDate.getHours() - thresholdHours);
  const thresholdIso = thresholdDate.toISOString();

  const queueItems = listQueue({ limit: 1000 });

  for (const item of queueItems) {
    try {
      if (item.createdAt < thresholdIso) {
        const post = getPostById(item.postId);
        // Only remove stale items for posts that are no longer pending
        if (!post || (post.status !== 'pending' && post.status !== 'draft')) {
          deleteQueueItem(item.id);
          removed++;
          logInfo('Removed stale queue item', {
            queueItemId: item.id,
            postId: item.postId,
            createdAt: item.createdAt,
            postStatus: post?.status ?? 'not_found',
          });
        }
      }
    } catch (error) {
      logError('Failed to check/remove stale queue item', error, { queueItemId: item.id });
      errors.push({
        type: 'stale_cleanup',
        message: error instanceof Error ? error.message : 'Unknown error',
        itemId: item.id,
        postId: item.postId,
      });
    }
  }

  return { removed, errors };
}

function queuePendingPosts(): { queued: number; errors: QueueProcessError[] } {
  const errors: QueueProcessError[] = [];
  let queued = 0;

  const currentQueueSize = countQueue();
  if (currentQueueSize >= workerConfig.maxQueueSize) {
    logInfo('Queue at max capacity, skipping pending post scheduling', {
      currentSize: currentQueueSize,
      maxSize: workerConfig.maxQueueSize,
    });
    return { queued: 0, errors: [] };
  }

  const pendingPosts = listPosts({ status: 'pending', limit: 100, orderBy: 'created_at' });

  for (const post of pendingPosts) {
    if (currentQueueSize + queued >= workerConfig.maxQueueSize) {
      break;
    }

    try {
      const existingQueueItem = getQueueItemByPostId(post.id);
      if (existingQueueItem) {
        continue;
      }

      const priority = calculatePostPriority(post);
      createQueueItem({ postId: post.id, priority });
      queued++;
      logInfo('Added pending post to queue', { postId: post.id, priority });
    } catch (error) {
      logError('Failed to queue pending post', error, { postId: post.id });
      errors.push({
        type: 'scheduling',
        message: error instanceof Error ? error.message : 'Unknown error',
        postId: post.id,
      });
    }
  }

  return { queued, errors };
}

function calculatePostPriority(post: Post): number {
  let priority = 50; // base priority

  // Higher confidence = higher priority
  priority += Math.round(post.confidenceScore * 0.3);

  // Time-sensitive content gets boost
  if (post.reasoning.timing === 'time-sensitive') {
    priority += 20;
  }

  // Posts with fewer concerns get priority
  const concernCount = post.reasoning.concerns?.length ?? 0;
  priority -= concernCount * 5;

  // Ensure priority stays within bounds
  return Math.max(0, Math.min(100, priority));
}

function updateQueuePriorities(): { updated: number; errors: QueueProcessError[] } {
  const errors: QueueProcessError[] = [];
  let updated = 0;

  const queueItems = listQueue({ limit: 500 });

  for (const item of queueItems) {
    try {
      const post = getPostById(item.postId);
      if (!post || post.status !== 'pending') {
        continue;
      }

      const newPriority = calculatePostPriority(post);
      if (newPriority !== item.priority) {
        updateQueueItem(item.id, { priority: newPriority });
        updated++;
      }
    } catch (error) {
      logError('Failed to update queue item priority', error, { queueItemId: item.id });
      errors.push({
        type: 'priority_update',
        message: error instanceof Error ? error.message : 'Unknown error',
        itemId: item.id,
        postId: item.postId,
      });
    }
  }

  if (updated > 0) {
    logInfo('Updated queue priorities', { count: updated });
  }

  return { updated, errors };
}

export function processQueue(): QueueProcessResult {
  const startTime = Date.now();
  const allErrors: QueueProcessError[] = [];

  logInfo('Starting queue processing');

  // Step 1: Remove orphaned queue items (posts that no longer exist)
  const orphanResult = removeOrphanedQueueItems();
  allErrors.push(...orphanResult.errors);

  // Step 2: Remove stale queue items
  const staleResult = removeStaleQueueItems(workerConfig.staleThresholdHours);
  allErrors.push(...staleResult.errors);

  // Step 3: Queue pending posts that aren't in the queue yet
  const queueResult = queuePendingPosts();
  allErrors.push(...queueResult.errors);

  // Step 4: Update priorities for existing queue items
  const priorityResult = updateQueuePriorities();
  allErrors.push(...priorityResult.errors);

  const duration = Date.now() - startTime;
  const result: QueueProcessResult = {
    orphanedRemoved: orphanResult.removed,
    staleRemoved: staleResult.removed,
    pendingPostsQueued: queueResult.queued,
    prioritiesUpdated: priorityResult.updated,
    errors: allErrors,
    duration,
  };

  logInfo('Queue processing completed', {
    orphanedRemoved: result.orphanedRemoved,
    staleRemoved: result.staleRemoved,
    pendingPostsQueued: result.pendingPostsQueued,
    prioritiesUpdated: result.prioritiesUpdated,
    errorCount: allErrors.length,
    durationMs: duration,
  });

  if (allErrors.length > 0) {
    logWarn('Queue processing completed with errors', { errorCount: allErrors.length });
  }

  return result;
}

export function startQueueWorker(onProcess?: (result: QueueProcessResult) => void): void {
  if (processTimer !== null) {
    logInfo('Worker already running, skipping start');
    return;
  }

  if (!workerConfig.enabled) {
    logInfo('Worker disabled, skipping start');
    return;
  }

  logInfo('Starting queue worker', { processIntervalMs: workerConfig.processIntervalMs });
  shutdownRequested = false;

  const runProcess = (): void => {
    if (isProcessing || shutdownRequested) return;
    isProcessing = true;

    try {
      const result = processQueue();
      onProcess?.(result);
    } finally {
      isProcessing = false;
      if (shutdownRequested) {
        for (const resolve of completionResolvers) {
          resolve();
        }
        completionResolvers = [];
      }
    }
  };

  runProcess();

  processTimer = setInterval(() => {
    runProcess();
  }, workerConfig.processIntervalMs);
}

export function stopQueueWorker(): void {
  if (processTimer !== null) {
    clearInterval(processTimer);
    processTimer = null;
    shutdownRequested = true;
    logInfo('Queue worker stopped');
  }
}

export function awaitQueueWorkerCompletion(): Promise<void> {
  if (!isProcessing) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    completionResolvers.push(resolve);
  });
}

export function isQueueWorkerRunning(): boolean {
  return processTimer !== null;
}

export function isQueueWorkerProcessing(): boolean {
  return isProcessing;
}

export interface QueueStats {
  totalItems: number;
  pendingPostsCount: number;
  postsInQueue: number;
  postsNotInQueue: number;
}

export function getQueueStats(): QueueStats {
  const totalItems = countQueue();
  const pendingPostsCount = countPosts('pending');
  const queueItems = listQueue({ limit: 1000 });

  const queuePostIds = new Set(queueItems.map((item) => item.postId));
  const pendingPosts = listPosts({ status: 'pending', limit: 1000 });

  let postsInQueue = 0;
  let postsNotInQueue = 0;

  for (const post of pendingPosts) {
    if (queuePostIds.has(post.id)) {
      postsInQueue++;
    } else {
      postsNotInQueue++;
    }
  }

  return {
    totalItems,
    pendingPostsCount,
    postsInQueue,
    postsNotInQueue,
  };
}
