/**
 * Python Worker Services Client
 *
 * Unified TypeScript client for all Python worker services:
 * - LiteLLM Gateway (port 8001): Multi-provider LLM access
 * - LangGraph Worker (port 8002): Content generation pipeline
 * - Stylometry Worker (port 8003): Voice authenticity analysis
 */

import { createLogger } from '@/lib/logger';

const logger = createLogger('workers-client');

// Environment configuration
const LITELLM_URL = process.env.LITELLM_GATEWAY_URL ?? 'http://localhost:8001';
const LANGGRAPH_URL = process.env.LANGGRAPH_WORKER_URL ?? 'http://localhost:8002';
const STYLOMETRY_URL = process.env.STYLOMETRY_WORKER_URL ?? 'http://localhost:8003';
const DEFAULT_TIMEOUT = parseInt(process.env.WORKER_TIMEOUT ?? '30000', 10);

// ============================================================================
// Shared Types
// ============================================================================

export type WorkerServiceName = 'litellm' | 'langgraph' | 'stylometry';
export type WorkerStatus = 'healthy' | 'degraded' | 'unavailable';

export interface DependencyStatus {
  name: string;
  status: WorkerStatus;
  latency_ms?: number;
  details?: Record<string, unknown>;
}

export interface WorkerHealthResponse {
  service: string;
  status: WorkerStatus;
  version: string;
  timestamp: string;
  uptime_seconds: number;
  dependencies: DependencyStatus[];
  checks: Record<string, boolean | string | number>;
}

export interface AllWorkersHealth {
  litellm: WorkerHealthResponse | null;
  langgraph: WorkerHealthResponse | null;
  stylometry: WorkerHealthResponse | null;
  overall: WorkerStatus;
  availableServices: WorkerServiceName[];
  timestamp: string;
}

// ============================================================================
// Error Classes
// ============================================================================

export class WorkerClientError extends Error {
  constructor(
    message: string,
    public service: WorkerServiceName,
    public statusCode?: number,
    public response?: unknown
  ) {
    super(message);
    this.name = 'WorkerClientError';
  }
}

export class WorkerConnectionError extends WorkerClientError {
  constructor(service: WorkerServiceName, cause?: Error) {
    super(`Failed to connect to ${service} worker`, service);
    this.name = 'WorkerConnectionError';
    this.cause = cause;
  }
}

export class WorkerTimeoutError extends WorkerClientError {
  constructor(service: WorkerServiceName, timeoutMs: number) {
    super(`Request to ${service} worker timed out after ${timeoutMs}ms`, service);
    this.name = 'WorkerTimeoutError';
  }
}

// ============================================================================
// LiteLLM Types
// ============================================================================

export interface LiteLLMCompletionRequest {
  model: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  max_tokens?: number;
  temperature?: number;
  stop?: string[];
}

export interface LiteLLMCompletionResponse {
  content: string;
  model: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
  stop_reason: string | null;
}

// ============================================================================
// Stylometry Types
// ============================================================================

export interface SentenceLengthStats {
  mean: number;
  std_dev: number;
  min: number;
  max: number;
  count: number;
  distribution: number[];
}

export interface PunctuationFingerprint {
  period: number;
  comma: number;
  exclamation: number;
  question: number;
  hyphen: number;
  em_dash: number;
  ellipsis: number;
  semicolon: number;
  colon: number;
  total: number;
}

export interface VocabularyRichnessStats {
  type_token_ratio: number;
  hapax_legomena: number;
  hapax_ratio: number;
  total_words: number;
  unique_words: number;
}

export interface FunctionWordDistribution {
  the: number;
  and: number;
  but: number;
  of: number;
  to: number;
  a: number;
  in: number;
  that: number;
  is: number;
  it: number;
  for: number;
  as: number;
  with: number;
  was: number;
  be: number;
  by: number;
  on: number;
  not: number;
  or: number;
  are: number;
  total: number;
}

export interface SyntacticComplexityStats {
  avg_clause_depth: number;
  avg_words_per_clause: number;
  subordinate_clause_ratio: number;
}

export interface StylometricAnalysis {
  sentence_length: SentenceLengthStats;
  punctuation: PunctuationFingerprint;
  vocabulary: VocabularyRichnessStats;
  function_words: FunctionWordDistribution;
  syntactic: SyntacticComplexityStats;
}

export interface StylometricAnalyzeResponse {
  success: boolean;
  analysis: StylometricAnalysis | null;
  error: string | null;
}

export interface StylometricCompareResponse {
  success: boolean;
  similarity_score: number;
  dimension_scores: Record<string, number>;
  analysis_a: StylometricAnalysis | null;
  analysis_b: StylometricAnalysis | null;
  error: string | null;
}

// ============================================================================
// Internal Helpers
// ============================================================================

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
  } finally {
    clearTimeout(timeoutId);
  }
}

function getServiceUrl(service: WorkerServiceName): string {
  switch (service) {
    case 'litellm':
      return LITELLM_URL;
    case 'langgraph':
      return LANGGRAPH_URL;
    case 'stylometry':
      return STYLOMETRY_URL;
  }
}

async function workerRequest<T>(
  service: WorkerServiceName,
  path: string,
  options: {
    method?: 'GET' | 'POST';
    body?: unknown;
    timeout?: number;
  } = {}
): Promise<T> {
  const { method = 'GET', body, timeout = DEFAULT_TIMEOUT } = options;
  const baseUrl = getServiceUrl(service);
  const url = `${baseUrl}${path}`;

  const fetchOptions: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
  };

  if (body !== undefined) {
    fetchOptions.body = JSON.stringify(body);
  }

  try {
    const response = await fetchWithTimeout(url, fetchOptions, timeout);

    if (!response.ok) {
      const errorBody = await response.text();
      throw new WorkerClientError(
        `${service} worker returned ${response.status}: ${errorBody}`,
        service,
        response.status,
        errorBody
      );
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof WorkerClientError) {
      throw error;
    }

    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new WorkerTimeoutError(service, timeout);
      }
      if (error.message.includes('ECONNREFUSED') || error.message.includes('fetch failed')) {
        throw new WorkerConnectionError(service, error);
      }
    }

    throw new WorkerClientError(
      `Request to ${service} worker failed: ${error instanceof Error ? error.message : String(error)}`,
      service
    );
  }
}

// ============================================================================
// Health Check Functions
// ============================================================================

const availabilityCache: Record<WorkerServiceName, { available: boolean; checkedAt: number }> = {
  litellm: { available: false, checkedAt: 0 },
  langgraph: { available: false, checkedAt: 0 },
  stylometry: { available: false, checkedAt: 0 },
};
const AVAILABILITY_CACHE_TTL = 60_000;

export async function checkWorkerHealth(
  service: WorkerServiceName,
  options: { timeout?: number; deep?: boolean } = {}
): Promise<WorkerHealthResponse> {
  const { timeout = 5000, deep = false } = options;
  const path = service === 'litellm' && deep ? '/health?deep=true' : '/health';
  return workerRequest<WorkerHealthResponse>(service, path, { method: 'GET', timeout });
}

export async function isWorkerAvailable(
  service: WorkerServiceName,
  options: { timeout?: number; useCache?: boolean } = {}
): Promise<boolean> {
  const { timeout = 5000, useCache = true } = options;

  if (useCache) {
    const cached = availabilityCache[service];
    if (Date.now() - cached.checkedAt < AVAILABILITY_CACHE_TTL) {
      return cached.available;
    }
  }

  try {
    const health = await checkWorkerHealth(service, { timeout });
    const available = health.status !== 'unavailable';
    availabilityCache[service] = { available, checkedAt: Date.now() };
    return available;
  } catch {
    availabilityCache[service] = { available: false, checkedAt: Date.now() };
    return false;
  }
}

export async function checkAllWorkersHealth(
  options: { timeout?: number } = {}
): Promise<AllWorkersHealth> {
  const { timeout = 5000 } = options;
  const timestamp = new Date().toISOString();

  const [litellmResult, langgraphResult, stylometryResult] = await Promise.allSettled([
    checkWorkerHealth('litellm', { timeout }),
    checkWorkerHealth('langgraph', { timeout }),
    checkWorkerHealth('stylometry', { timeout }),
  ]);

  const litellm = litellmResult.status === 'fulfilled' ? litellmResult.value : null;
  const langgraph = langgraphResult.status === 'fulfilled' ? langgraphResult.value : null;
  const stylometry = stylometryResult.status === 'fulfilled' ? stylometryResult.value : null;

  const availableServices: WorkerServiceName[] = [];
  // Only consider a service available if we got a response AND it's not 'unavailable'
  if (litellm !== null && litellm.status !== 'unavailable') availableServices.push('litellm');
  if (langgraph !== null && langgraph.status !== 'unavailable') availableServices.push('langgraph');
  if (stylometry !== null && stylometry.status !== 'unavailable')
    availableServices.push('stylometry');

  let overall: WorkerStatus = 'healthy';
  if (availableServices.length === 0) {
    overall = 'unavailable';
  } else if (availableServices.length < 3) {
    overall = 'degraded';
  } else {
    const anyDegraded = [litellm, langgraph, stylometry].some((h) => h?.status === 'degraded');
    if (anyDegraded) overall = 'degraded';
  }

  availabilityCache.litellm = { available: !!litellm, checkedAt: Date.now() };
  availabilityCache.langgraph = { available: !!langgraph, checkedAt: Date.now() };
  availabilityCache.stylometry = { available: !!stylometry, checkedAt: Date.now() };

  return {
    litellm,
    langgraph,
    stylometry,
    overall,
    availableServices,
    timestamp,
  };
}

export function clearAvailabilityCache(): void {
  availabilityCache.litellm = { available: false, checkedAt: 0 };
  availabilityCache.langgraph = { available: false, checkedAt: 0 };
  availabilityCache.stylometry = { available: false, checkedAt: 0 };
}

// ============================================================================
// LiteLLM Client Functions
// ============================================================================

export async function litellmCompletion(
  request: LiteLLMCompletionRequest,
  options: { timeout?: number } = {}
): Promise<LiteLLMCompletionResponse> {
  const { timeout = 120_000 } = options;
  logger.debug('LiteLLM completion request', {
    model: request.model,
    messageCount: request.messages.length,
  });

  const response = await workerRequest<LiteLLMCompletionResponse>('litellm', '/completion', {
    method: 'POST',
    body: request,
    timeout,
  });

  logger.debug('LiteLLM completion response', {
    model: response.model,
    tokens: response.usage.total_tokens,
  });

  return response;
}

// ============================================================================
// Stylometry Client Functions
// ============================================================================

export async function stylometryAnalyze(
  text: string,
  options: { timeout?: number } = {}
): Promise<StylometricAnalyzeResponse> {
  const { timeout = DEFAULT_TIMEOUT } = options;
  logger.debug('Stylometry analyze request', { textLength: text.length });

  return workerRequest<StylometricAnalyzeResponse>('stylometry', '/analyze', {
    method: 'POST',
    body: { text },
    timeout,
  });
}

export async function stylometryCompare(
  textA: string,
  textB: string,
  options: { timeout?: number } = {}
): Promise<StylometricCompareResponse> {
  const { timeout = DEFAULT_TIMEOUT } = options;
  logger.debug('Stylometry compare request', {
    textALength: textA.length,
    textBLength: textB.length,
  });

  return workerRequest<StylometricCompareResponse>('stylometry', '/compare', {
    method: 'POST',
    body: { text_a: textA, text_b: textB },
    timeout,
  });
}

export async function stylometrySentenceLength(
  text: string,
  options: { timeout?: number } = {}
): Promise<SentenceLengthStats> {
  const { timeout = DEFAULT_TIMEOUT } = options;
  return workerRequest<SentenceLengthStats>('stylometry', '/sentence-length', {
    method: 'POST',
    body: { text },
    timeout,
  });
}

export async function stylometryPunctuation(
  text: string,
  options: { timeout?: number } = {}
): Promise<PunctuationFingerprint> {
  const { timeout = DEFAULT_TIMEOUT } = options;
  return workerRequest<PunctuationFingerprint>('stylometry', '/punctuation', {
    method: 'POST',
    body: { text },
    timeout,
  });
}

export async function stylometryVocabulary(
  text: string,
  options: { timeout?: number } = {}
): Promise<VocabularyRichnessStats> {
  const { timeout = DEFAULT_TIMEOUT } = options;
  return workerRequest<VocabularyRichnessStats>('stylometry', '/vocabulary', {
    method: 'POST',
    body: { text },
    timeout,
  });
}

export async function stylometryFunctionWords(
  text: string,
  options: { timeout?: number } = {}
): Promise<FunctionWordDistribution> {
  const { timeout = DEFAULT_TIMEOUT } = options;
  return workerRequest<FunctionWordDistribution>('stylometry', '/function-words', {
    method: 'POST',
    body: { text },
    timeout,
  });
}

export async function stylometrySyntactic(
  text: string,
  options: { timeout?: number } = {}
): Promise<SyntacticComplexityStats> {
  const { timeout = DEFAULT_TIMEOUT } = options;
  return workerRequest<SyntacticComplexityStats>('stylometry', '/syntactic', {
    method: 'POST',
    body: { text },
    timeout,
  });
}

// ============================================================================
// Utility Functions
// ============================================================================

export function getWorkerUrls(): Record<WorkerServiceName, string> {
  return {
    litellm: LITELLM_URL,
    langgraph: LANGGRAPH_URL,
    stylometry: STYLOMETRY_URL,
  };
}

export function getWorkerConfig(): {
  urls: Record<WorkerServiceName, string>;
  defaultTimeout: number;
  cacheTtl: number;
} {
  return {
    urls: getWorkerUrls(),
    defaultTimeout: DEFAULT_TIMEOUT,
    cacheTtl: AVAILABILITY_CACHE_TTL,
  };
}
