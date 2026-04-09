import { listSources, updateSource } from '@/db/models/sources';
import { createPost } from '@/db/models/posts';
import { createQueueItem } from '@/db/models/queue';
import { generateContent, toPost } from '@/lib/generation/generator';
import type { Source, Post } from '@/types';
import { shouldAllowOperation, checkAndHaltIfBudgetExhausted } from '@/lib/costs/operations-halt';

function logInfo(message: string, data?: Record<string, unknown>): void {
  const timestamp = new Date().toISOString();
  const logData = data ? ` ${JSON.stringify(data)}` : '';
  // eslint-disable-next-line no-console
  console.log(`[${timestamp}] [generation-worker] INFO: ${message}${logData}`);
}

function logError(message: string, error?: unknown, data?: Record<string, unknown>): void {
  const timestamp = new Date().toISOString();
  const errorMsg = error instanceof Error ? error.message : String(error ?? '');
  const logData = data ? ` ${JSON.stringify(data)}` : '';
  const errorSuffix = errorMsg ? `: ${errorMsg}` : '';
  console.error(`[${timestamp}] [generation-worker] ERROR: ${message}${errorSuffix}${logData}`);
}

function logWarn(message: string, data?: Record<string, unknown>): void {
  const timestamp = new Date().toISOString();
  const logData = data ? ` ${JSON.stringify(data)}` : '';
  console.warn(`[${timestamp}] [generation-worker] WARN: ${message}${logData}`);
}

export interface GenerationWorkerConfig {
  processIntervalMs: number;
  batchSize: number;
  enabled: boolean;
  minConfidenceForQueue: number;
  retryFailedSources: boolean;
  maxRetries: number;
}

export interface GenerationProcessResult {
  sourcesProcessed: number;
  postsCreated: number;
  postsQueued: number;
  sourcesFailed: number;
  errors: GenerationError[];
  duration: number;
}

export interface GenerationError {
  sourceId: string;
  message: string;
  retryCount: number;
}

const DEFAULT_CONFIG: GenerationWorkerConfig = {
  processIntervalMs: 2 * 60 * 1000,
  batchSize: 5,
  enabled: true,
  minConfidenceForQueue: 50,
  retryFailedSources: true,
  maxRetries: 2,
};

let workerConfig: GenerationWorkerConfig = { ...DEFAULT_CONFIG };
let processTimer: NodeJS.Timeout | null = null;
let isProcessing = false;
let shutdownRequested = false;
let completionResolvers: Array<() => void> = [];

export function getGenerationWorkerConfig(): GenerationWorkerConfig {
  return { ...workerConfig };
}

export function configureGenerationWorker(config: Partial<GenerationWorkerConfig>): void {
  workerConfig = { ...workerConfig, ...config };
}

export function resetGenerationWorkerConfig(): void {
  workerConfig = { ...DEFAULT_CONFIG };
}

function getUnprocessedSources(limit: number): Source[] {
  const sources = listSources({
    limit: limit * 3,
    orderBy: 'scraped_at',
    orderDir: 'desc',
  });

  return sources
    .filter((source) => {
      const meta = source.metadata;
      if (meta.processedAt !== undefined) return false;
      if (meta.processingFailed === true && !workerConfig.retryFailedSources) return false;
      if ((meta.retryCount ?? 0) >= workerConfig.maxRetries) return false;
      return true;
    })
    .slice(0, limit);
}

function markSourceProcessed(source: Source): void {
  const meta = source.metadata;
  updateSource(source.id, {
    metadata: {
      ...meta,
      processedAt: new Date().toISOString(),
      processingFailed: false,
      processingError: undefined,
    },
  });
}

function markSourceFailed(source: Source, error: string): void {
  const meta = source.metadata;
  const retryCount = (meta.retryCount ?? 0) + 1;
  updateSource(source.id, {
    metadata: {
      ...meta,
      processingFailed: true,
      processingError: error,
      retryCount,
    },
  });
}

async function processSource(source: Source): Promise<{ post: Post | null; queued: boolean }> {
  const output = await generateContent(source, {
    maxRewriteAttempts: 2,
  });

  if (!output.success && !output.flagForHumanReview) {
    logWarn('Generation failed', {
      sourceId: source.sourceId,
      reason: output.failureReason,
    });
    return { post: null, queued: false };
  }

  const postData = toPost(output);
  const post = createPost({
    content: postData.content,
    type: postData.type,
    status: postData.status,
    confidenceScore: postData.confidenceScore,
    reasoning: postData.reasoning,
    voiceEvaluation: postData.voiceEvaluation ?? undefined,
  });

  let queued = false;
  if (post.status === 'pending' && post.confidenceScore >= workerConfig.minConfidenceForQueue) {
    createQueueItem({
      postId: post.id,
      priority: Math.round(post.confidenceScore),
    });
    queued = true;
  }

  return { post, queued };
}

export async function processNewSources(): Promise<GenerationProcessResult> {
  const startTime = Date.now();
  const errors: GenerationError[] = [];
  let sourcesProcessed = 0;
  let postsCreated = 0;
  let postsQueued = 0;
  let sourcesFailed = 0;

  checkAndHaltIfBudgetExhausted();

  if (!shouldAllowOperation('anthropic')) {
    logWarn('Generation halted due to budget constraints');
    return {
      sourcesProcessed: 0,
      postsCreated: 0,
      postsQueued: 0,
      sourcesFailed: 0,
      errors: [
        {
          sourceId: '',
          message: 'Operations halted due to budget constraints',
          retryCount: 0,
        },
      ],
      duration: Date.now() - startTime,
    };
  }

  const sources = getUnprocessedSources(workerConfig.batchSize);

  if (sources.length === 0) {
    logInfo('No unprocessed sources found');
    return {
      sourcesProcessed: 0,
      postsCreated: 0,
      postsQueued: 0,
      sourcesFailed: 0,
      errors: [],
      duration: Date.now() - startTime,
    };
  }

  logInfo('Processing new sources', { count: sources.length });

  for (const source of sources) {
    sourcesProcessed++;

    try {
      const { post, queued } = await processSource(source);

      if (post) {
        postsCreated++;
        if (queued) {
          postsQueued++;
        }
        markSourceProcessed(source);
        logInfo('Generated post', {
          sourceId: source.sourceId,
          postId: post.id,
          status: post.status,
          confidence: post.confidenceScore,
          queued,
        });
      } else {
        markSourceFailed(source, 'Generation failed');
        sourcesFailed++;
      }
    } catch (error) {
      sourcesFailed++;
      const meta = source.metadata;
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';

      logError('Source processing failed', error, { sourceId: source.sourceId });
      markSourceFailed(source, errorMsg);

      errors.push({
        sourceId: source.sourceId,
        message: errorMsg,
        retryCount: (meta.retryCount ?? 0) + 1,
      });
    }
  }

  const duration = Date.now() - startTime;

  logInfo('Source processing completed', {
    sourcesProcessed,
    postsCreated,
    postsQueued,
    sourcesFailed,
    errorCount: errors.length,
    durationMs: duration,
  });

  return {
    sourcesProcessed,
    postsCreated,
    postsQueued,
    sourcesFailed,
    errors,
    duration,
  };
}

export function startGenerationWorker(onProcess?: (result: GenerationProcessResult) => void): void {
  if (processTimer !== null) {
    logInfo('Worker already running, skipping start');
    return;
  }

  if (!workerConfig.enabled) {
    logInfo('Worker disabled, skipping start');
    return;
  }

  logInfo('Starting generation worker', {
    processIntervalMs: workerConfig.processIntervalMs,
    batchSize: workerConfig.batchSize,
  });
  shutdownRequested = false;

  const runProcess = async (): Promise<void> => {
    if (isProcessing || shutdownRequested) return;
    isProcessing = true;

    try {
      const result = await processNewSources();
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

  void runProcess();

  processTimer = setInterval(() => {
    void runProcess();
  }, workerConfig.processIntervalMs);
}

export function stopGenerationWorker(): void {
  if (processTimer !== null) {
    clearInterval(processTimer);
    processTimer = null;
    shutdownRequested = true;
    logInfo('Generation worker stopped');
  }
}

export function awaitGenerationWorkerCompletion(): Promise<void> {
  if (!isProcessing) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    completionResolvers.push(resolve);
  });
}

export function isGenerationWorkerRunning(): boolean {
  return processTimer !== null;
}

export function isGenerationWorkerProcessing(): boolean {
  return isProcessing;
}

export async function triggerGeneration(): Promise<GenerationProcessResult> {
  if (isProcessing) {
    logWarn('Generation already in progress, skipping trigger');
    return {
      sourcesProcessed: 0,
      postsCreated: 0,
      postsQueued: 0,
      sourcesFailed: 0,
      errors: [],
      duration: 0,
    };
  }

  return processNewSources();
}
