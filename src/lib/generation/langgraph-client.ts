/**
 * LangGraph HTTP Client
 *
 * TypeScript client for the Python LangGraph generation pipeline.
 * Communicates with the FastAPI server at /workers/langgraph/server.py
 */

import { createLogger } from '@/lib/logger';
import {
  createGenerationJob,
  startGenerationJob,
  completeGenerationJob,
  failGenerationJob,
  updateGenerationJob,
} from '@/db/models/generation-jobs';
import type { GenerationJob } from '@/types';

const logger = createLogger('langgraph-client');

const LANGGRAPH_URL = process.env.LANGGRAPH_WORKER_URL ?? 'http://localhost:8002';
const LANGGRAPH_TIMEOUT = parseInt(process.env.LANGGRAPH_TIMEOUT ?? '120000', 10);

export interface SourceMaterial {
  id: string;
  content: string;
  source_type: 'like' | 'bookmark' | 'scraped';
  author?: string | null;
  url?: string | null;
  metadata?: Record<string, unknown>;
}

export interface GenerationRequest {
  sources: SourceMaterial[];
  content_type?: 'standalone' | 'thread' | 'quote_tweet';
  formula_id?: string | null;
  max_rewrites?: number;
  debug?: boolean;
}

export interface ConfidenceScores {
  voice?: number;
  hook?: number;
  topic?: number;
  originality?: number;
  overall?: number;
}

export interface GenerationReasoning {
  key_insight?: string;
  why_it_works?: string;
  timing?: string;
  concerns?: string[];
  note?: string;
  sources_received?: number;
}

export interface DebugTraceEntry {
  node: string;
  message?: string;
  timestamp?: string;
  duration_ms?: number;
  state?: Record<string, unknown>;
}

export interface GenerationResult {
  id: string;
  status: 'success' | 'rejected' | 'error';
  content: string | null;
  content_type: 'standalone' | 'thread' | 'quote_tweet';
  thread_tweets: string[] | null;
  confidence: ConfidenceScores;
  reasoning: GenerationReasoning;
  rewrite_count: number;
  rejection_reason: string | null;
  debug_trace: DebugTraceEntry[] | null;
  duration_ms: number;
}

export interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unavailable';
  qdrant_connected: boolean;
  litellm_available: boolean;
  anthropic_configured: boolean;
  openai_configured: boolean;
  timestamp: string;
}

export interface VoiceCheckRequest {
  content: string;
  threshold?: number;
}

export interface SimilarPost {
  id: string;
  content: string;
  similarity: number;
}

export interface VoiceCheckResponse {
  passes: boolean;
  similarity_score: number;
  similar_posts: SimilarPost[];
}

export interface JobInfo {
  job_id: string;
  thread_id: string;
  status: 'running' | 'completed';
  content_type: string;
  source_count: number;
  started_at: string;
  completed_at: string | null;
  final_status: string | null;
  error: string | null;
}

export interface CheckpointInfo {
  checkpoint_id: string;
  created_at: string;
  state: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export interface DebugTraceResponse {
  job_id: string;
  found: boolean;
  job_info: JobInfo | null;
  checkpoints: CheckpointInfo[] | null;
  trace: DebugTraceEntry[] | null;
}

export interface CheckpointStateResponse {
  job_id: string;
  checkpoint_id: string;
  found: boolean;
  state: Record<string, unknown> | null;
  created_at: string | null;
}

export class LangGraphClientError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly response?: unknown
  ) {
    super(message);
    this.name = 'LangGraphClientError';
  }
}

export class LangGraphConnectionError extends LangGraphClientError {
  constructor(message: string) {
    super(message);
    this.name = 'LangGraphConnectionError';
  }
}

export class LangGraphTimeoutError extends LangGraphClientError {
  constructor(durationMs: number) {
    super(`LangGraph request timed out after ${durationMs}ms`);
    this.name = 'LangGraphTimeoutError';
  }
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new LangGraphTimeoutError(timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let errorBody: unknown;
    try {
      errorBody = await response.json();
    } catch {
      errorBody = await response.text();
    }
    throw new LangGraphClientError(
      `LangGraph request failed: ${response.status} ${response.statusText}`,
      response.status,
      errorBody
    );
  }
  return response.json() as Promise<T>;
}

export async function checkHealth(): Promise<HealthResponse> {
  try {
    const response = await fetchWithTimeout(
      `${LANGGRAPH_URL}/health`,
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      },
      10000
    );
    return handleResponse<HealthResponse>(response);
  } catch (error) {
    if (error instanceof LangGraphTimeoutError) {
      throw error;
    }
    if (error instanceof LangGraphClientError) {
      throw error;
    }
    logger.error('LangGraph health check failed', { error });
    throw new LangGraphConnectionError(
      `Failed to connect to LangGraph worker at ${LANGGRAPH_URL}: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

export async function isAvailable(): Promise<boolean> {
  try {
    const health = await checkHealth();
    return health.status !== 'unavailable';
  } catch {
    return false;
  }
}

export async function generateContent(request: GenerationRequest): Promise<GenerationResult> {
  const startTime = Date.now();

  logger.info('Starting LangGraph generation', {
    sourceCount: request.sources.length,
    contentType: request.content_type ?? 'standalone',
    debug: request.debug === true,
  });

  try {
    const response = await fetchWithTimeout(
      `${LANGGRAPH_URL}/generate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sources: request.sources,
          content_type: request.content_type ?? 'standalone',
          formula_id: request.formula_id ?? null,
          max_rewrites: request.max_rewrites ?? 3,
          debug: request.debug === true,
        }),
      },
      LANGGRAPH_TIMEOUT
    );

    const result = await handleResponse<GenerationResult>(response);

    logger.info('LangGraph generation complete', {
      jobId: result.id,
      status: result.status,
      rewriteCount: result.rewrite_count,
      durationMs: result.duration_ms,
      clientDurationMs: Date.now() - startTime,
    });

    return result;
  } catch (error) {
    logger.error('LangGraph generation failed', {
      error,
      durationMs: Date.now() - startTime,
    });
    throw error;
  }
}

export async function checkVoice(request: VoiceCheckRequest): Promise<VoiceCheckResponse> {
  try {
    const response = await fetchWithTimeout(
      `${LANGGRAPH_URL}/voice-check`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: request.content,
          threshold: request.threshold ?? 0.7,
        }),
      },
      30000
    );

    return handleResponse<VoiceCheckResponse>(response);
  } catch (error) {
    logger.error('LangGraph voice check failed', { error });
    throw error;
  }
}

export async function getDebugTrace(jobId: string): Promise<DebugTraceResponse> {
  try {
    const response = await fetchWithTimeout(
      `${LANGGRAPH_URL}/debug/${encodeURIComponent(jobId)}`,
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      },
      10000
    );

    return handleResponse<DebugTraceResponse>(response);
  } catch (error) {
    logger.error('LangGraph debug trace retrieval failed', { error, jobId });
    throw error;
  }
}

export async function getCheckpointState(
  jobId: string,
  checkpointId: string
): Promise<CheckpointStateResponse> {
  try {
    const response = await fetchWithTimeout(
      `${LANGGRAPH_URL}/debug/${encodeURIComponent(jobId)}/checkpoint/${encodeURIComponent(checkpointId)}`,
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      },
      10000
    );

    return handleResponse<CheckpointStateResponse>(response);
  } catch (error) {
    logger.error('LangGraph checkpoint state retrieval failed', { error, jobId, checkpointId });
    throw error;
  }
}

export async function listRecentJobs(limit: number = 20): Promise<JobInfo[]> {
  try {
    const response = await fetchWithTimeout(
      `${LANGGRAPH_URL}/jobs?limit=${limit}`,
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      },
      10000
    );

    return handleResponse<JobInfo[]>(response);
  } catch (error) {
    logger.error('LangGraph job listing failed', { error });
    throw error;
  }
}

export function convertSourceToMaterial(source: {
  id: number;
  source_type: string;
  content: string;
  metadata?: string | null;
}): SourceMaterial {
  let parsedMetadata: Record<string, unknown> = {};
  if (source.metadata) {
    try {
      parsedMetadata = JSON.parse(source.metadata) as Record<string, unknown>;
    } catch {
      parsedMetadata = {};
    }
  }

  return {
    id: String(source.id),
    content: source.content,
    source_type: source.source_type as 'like' | 'bookmark' | 'scraped',
    author: (parsedMetadata.author as string | undefined) ?? null,
    url: (parsedMetadata.url as string | undefined) ?? null,
    metadata: parsedMetadata,
  };
}

export function convertResultToGenerationOutput(result: GenerationResult): {
  content: string | null;
  contentType: 'standalone' | 'thread' | 'quote_tweet';
  threadTweets: string[] | null;
  confidence: {
    voice: number;
    hook: number;
    topic: number;
    originality: number;
    overall: number;
  };
  reasoning: {
    keyInsight: string;
    whyItWorks: string;
    timing: string;
    concerns: string[];
  };
  rewriteCount: number;
  success: boolean;
  failureReason: string | null;
  jobId: string;
  durationMs: number;
  debugTrace: DebugTraceEntry[] | null;
} {
  return {
    content: result.content,
    contentType: result.content_type,
    threadTweets: result.thread_tweets,
    confidence: {
      voice: result.confidence.voice ?? 0,
      hook: result.confidence.hook ?? 0,
      topic: result.confidence.topic ?? 0,
      originality: result.confidence.originality ?? 0,
      overall: result.confidence.overall ?? 0,
    },
    reasoning: {
      keyInsight: result.reasoning.key_insight ?? '',
      whyItWorks: result.reasoning.why_it_works ?? '',
      timing: result.reasoning.timing ?? '',
      concerns: result.reasoning.concerns ?? [],
    },
    rewriteCount: result.rewrite_count,
    success: result.status === 'success',
    failureReason:
      result.status !== 'success' ? (result.rejection_reason ?? 'Unknown error') : null,
    jobId: result.id,
    durationMs: result.duration_ms,
    debugTrace: result.debug_trace,
  };
}

let cachedAvailability: { available: boolean; checkedAt: number } | null = null;
const AVAILABILITY_CACHE_TTL = 60000;

export async function isAvailableCached(): Promise<boolean> {
  const now = Date.now();
  if (cachedAvailability && now - cachedAvailability.checkedAt < AVAILABILITY_CACHE_TTL) {
    return cachedAvailability.available;
  }

  const available = await isAvailable();
  cachedAvailability = { available, checkedAt: now };
  return available;
}

export function resetAvailabilityCache(): void {
  cachedAvailability = null;
}

export function getLangGraphUrl(): string {
  return LANGGRAPH_URL;
}

export function getLangGraphTimeout(): number {
  return LANGGRAPH_TIMEOUT;
}

export interface TrackedGenerationRequest extends GenerationRequest {
  trackJob?: boolean;
}

export interface TrackedGenerationResult extends GenerationResult {
  tsJobId: string | null;
}

export async function generateContentTracked(
  request: TrackedGenerationRequest
): Promise<TrackedGenerationResult> {
  const { trackJob = true, ...generationRequest } = request;

  let job: GenerationJob | null = null;
  if (trackJob) {
    const sourceIds = request.sources.map((s) => parseInt(s.id, 10)).filter((id) => !isNaN(id));
    job = createGenerationJob({
      pipeline: 'langgraph',
      sourceIds: sourceIds.length > 0 ? sourceIds : undefined,
      contentType: request.content_type ?? 'standalone',
      metadata: {
        formulaId: request.formula_id,
        maxRewrites: request.max_rewrites,
        debug: request.debug,
      },
    });
    startGenerationJob(job.id);
  }

  try {
    const result = await generateContent(generationRequest);

    if (job) {
      if (result.status === 'success') {
        completeGenerationJob(job.id);
      } else {
        failGenerationJob(job.id, result.rejection_reason ?? 'Generation failed');
      }
      updateGenerationJob(job.id, {
        metadata: {
          formulaId: request.formula_id,
          maxRewrites: request.max_rewrites,
          rewriteCount: result.rewrite_count,
          durationMs: result.duration_ms,
          langGraphJobId: result.id,
          status: result.status,
        },
      });
    }

    return {
      ...result,
      tsJobId: job?.id ?? null,
    };
  } catch (error) {
    if (job) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      failGenerationJob(job.id, errorMessage);
    }
    throw error;
  }
}
