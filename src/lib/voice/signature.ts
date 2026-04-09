/**
 * Voice signature generation and comparison.
 * Creates quantifiable "fingerprints" of writing style based on stylometric analysis.
 */

import { getQdrantClient, QDRANT_COLLECTION_NAMES, collectionExists } from '@/db/qdrant/connection';
import { analyzeStylometry, PunctuationFingerprint, FunctionWordDistribution } from './stylometry';
import { createLogger } from '@/lib/logger';
import { STYLOMETRY_DIMENSION_WEIGHTS } from '@/lib/config/thresholds';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

const logger = createLogger('voice:signature');

interface CacheEntry {
  signature: StyleSignature;
  timestamp: number;
}

const SIGNATURE_CACHE_MAX_ENTRIES = parseInt(process.env.SIGNATURE_CACHE_MAX_ENTRIES ?? '1000', 10);
const SIGNATURE_CACHE_TTL_MS = parseInt(process.env.SIGNATURE_CACHE_TTL_MS ?? '3600000', 10); // 1 hour default
const signatureCache = new Map<string, CacheEntry>();

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function pruneSignatureCache(): void {
  if (signatureCache.size <= SIGNATURE_CACHE_MAX_ENTRIES) return;

  const entries = Array.from(signatureCache.entries());
  entries.sort((a, b) => a[1].timestamp - b[1].timestamp);

  const toRemove = entries.slice(0, signatureCache.size - SIGNATURE_CACHE_MAX_ENTRIES);
  for (const [key] of toRemove) {
    signatureCache.delete(key);
  }
}

function evictExpiredEntries(): void {
  const now = Date.now();
  for (const [key, entry] of signatureCache.entries()) {
    if (now - entry.timestamp > SIGNATURE_CACHE_TTL_MS) {
      signatureCache.delete(key);
    }
  }
}

const DATA_DIR = process.env.DATA_DIR ?? './data';
const BASELINE_SIGNATURE_PATH = path.join(DATA_DIR, 'baseline-signature.json');

export interface StyleSignature {
  sentenceLength: {
    mean: number;
    stdDev: number;
  };
  punctuation: {
    periodRate: number;
    commaRate: number;
    exclamationRate: number;
    questionRate: number;
    dashRate: number;
    ellipsisRate: number;
  };
  vocabulary: {
    typeTokenRatio: number;
    hapaxRatio: number;
  };
  functionWords: {
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
  };
  syntactic: {
    avgClauseDepth: number;
    avgWordsPerClause: number;
    subordinateClauseRatio: number;
  };
  metadata?: {
    textLength: number;
    sampleCount: number;
    generatedAt: string;
  };
}

export interface SignatureComparisonResult {
  overallSimilarity: number;
  dimensionScores: {
    sentenceLength: number;
    punctuation: number;
    vocabulary: number;
    functionWords: number;
    syntactic: number;
  };
  feedback: string[];
}

function getDimensionWeights(): typeof STYLOMETRY_DIMENSION_WEIGHTS {
  return STYLOMETRY_DIMENSION_WEIGHTS;
}

let cachedPersonaSignature: StyleSignature | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

function normalizePunctuationRates(
  fingerprint: PunctuationFingerprint
): StyleSignature['punctuation'] {
  const total = fingerprint.total || 1;
  return {
    periodRate: fingerprint.period / total,
    commaRate: fingerprint.comma / total,
    exclamationRate: fingerprint.exclamation / total,
    questionRate: fingerprint.question / total,
    dashRate: (fingerprint.hyphen + fingerprint.emDash) / total,
    ellipsisRate: fingerprint.ellipsis / total,
  };
}

function extractFunctionWordSubset(fw: FunctionWordDistribution): StyleSignature['functionWords'] {
  const f = fw.frequencies;
  return {
    the: f.the ?? 0,
    and: f.and ?? 0,
    but: f.but ?? 0,
    of: f.of ?? 0,
    to: f.to ?? 0,
    a: f.a ?? 0,
    in: f.in ?? 0,
    that: f.that ?? 0,
    is: f.is ?? 0,
    it: f.it ?? 0,
  };
}

function generateSignatureUncached(text: string): StyleSignature {
  const analysis = analyzeStylometry(text);

  return {
    sentenceLength: {
      mean: analysis.sentenceLength.mean,
      stdDev: analysis.sentenceLength.stdDev,
    },
    punctuation: normalizePunctuationRates(analysis.punctuation),
    vocabulary: {
      typeTokenRatio: analysis.vocabulary.typeTokenRatio,
      hapaxRatio: analysis.vocabulary.hapaxRatio,
    },
    functionWords: extractFunctionWordSubset(analysis.functionWords),
    syntactic: {
      avgClauseDepth: analysis.syntactic.avgClauseDepth,
      avgWordsPerClause: analysis.syntactic.avgWordsPerClause,
      subordinateClauseRatio: analysis.syntactic.subordinateClauseRatio,
    },
    metadata: {
      textLength: text.length,
      sampleCount: 1,
      generatedAt: new Date().toISOString(),
    },
  };
}

export function generateSignature(text: string, options?: { skipCache?: boolean }): StyleSignature {
  if (options?.skipCache === true) {
    return generateSignatureUncached(text);
  }

  const cacheKey = hashText(text);
  const now = Date.now();

  const cached = signatureCache.get(cacheKey);
  if (cached && now - cached.timestamp < SIGNATURE_CACHE_TTL_MS) {
    logger.debug('Signature cache hit', { keyPrefix: cacheKey.substring(0, 8) });
    return cached.signature;
  }

  const signature = generateSignatureUncached(text);

  signatureCache.set(cacheKey, { signature, timestamp: now });
  pruneSignatureCache();

  if (signatureCache.size % 100 === 0) {
    evictExpiredEntries();
  }

  logger.debug('Signature generated and cached', {
    keyPrefix: cacheKey.substring(0, 8),
    cacheSize: signatureCache.size,
  });

  return signature;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (normA * normB);
}

function gaussianSimilarity(a: number, b: number, sigma: number = 1): number {
  const diff = a - b;
  return Math.exp(-(diff * diff) / (2 * sigma * sigma));
}

function compareSentenceLength(a: StyleSignature, b: StyleSignature): number {
  const meanSim = gaussianSimilarity(a.sentenceLength.mean, b.sentenceLength.mean, 5);
  const stdSim = gaussianSimilarity(a.sentenceLength.stdDev, b.sentenceLength.stdDev, 3);
  return (meanSim + stdSim) / 2;
}

function comparePunctuation(a: StyleSignature, b: StyleSignature): number {
  const aVec = [
    a.punctuation.periodRate,
    a.punctuation.commaRate,
    a.punctuation.exclamationRate,
    a.punctuation.questionRate,
    a.punctuation.dashRate,
    a.punctuation.ellipsisRate,
  ];
  const bVec = [
    b.punctuation.periodRate,
    b.punctuation.commaRate,
    b.punctuation.exclamationRate,
    b.punctuation.questionRate,
    b.punctuation.dashRate,
    b.punctuation.ellipsisRate,
  ];
  return cosineSimilarity(aVec, bVec);
}

function compareVocabulary(a: StyleSignature, b: StyleSignature): number {
  const ttrSim = gaussianSimilarity(a.vocabulary.typeTokenRatio, b.vocabulary.typeTokenRatio, 0.15);
  const hapaxSim = gaussianSimilarity(a.vocabulary.hapaxRatio, b.vocabulary.hapaxRatio, 0.15);
  return (ttrSim + hapaxSim) / 2;
}

function compareFunctionWords(a: StyleSignature, b: StyleSignature): number {
  const aVec = [
    a.functionWords.the,
    a.functionWords.and,
    a.functionWords.but,
    a.functionWords.of,
    a.functionWords.to,
    a.functionWords.a,
    a.functionWords.in,
    a.functionWords.that,
    a.functionWords.is,
    a.functionWords.it,
  ];
  const bVec = [
    b.functionWords.the,
    b.functionWords.and,
    b.functionWords.but,
    b.functionWords.of,
    b.functionWords.to,
    b.functionWords.a,
    b.functionWords.in,
    b.functionWords.that,
    b.functionWords.is,
    b.functionWords.it,
  ];
  return cosineSimilarity(aVec, bVec);
}

function compareSyntactic(a: StyleSignature, b: StyleSignature): number {
  const depthSim = gaussianSimilarity(a.syntactic.avgClauseDepth, b.syntactic.avgClauseDepth, 1);
  const wordsSim = gaussianSimilarity(
    a.syntactic.avgWordsPerClause,
    b.syntactic.avgWordsPerClause,
    5
  );
  const subordSim = gaussianSimilarity(
    a.syntactic.subordinateClauseRatio,
    b.syntactic.subordinateClauseRatio,
    0.1
  );
  return (depthSim + wordsSim + subordSim) / 3;
}

function generateFeedback(
  a: StyleSignature,
  b: StyleSignature,
  scores: SignatureComparisonResult['dimensionScores']
): string[] {
  const feedback: string[] = [];
  const threshold = 0.7;

  if (scores.sentenceLength < threshold) {
    const meanDiff = Math.abs(a.sentenceLength.mean - b.sentenceLength.mean);
    if (meanDiff > 5) {
      feedback.push(
        `Sentence length differs: ${a.sentenceLength.mean.toFixed(1)} vs target ${b.sentenceLength.mean.toFixed(1)} words/sentence`
      );
    }
  }

  if (scores.punctuation < threshold) {
    if (Math.abs(a.punctuation.exclamationRate - b.punctuation.exclamationRate) > 0.1) {
      feedback.push(
        a.punctuation.exclamationRate > b.punctuation.exclamationRate
          ? 'Too many exclamation marks'
          : 'Consider adding more emphasis'
      );
    }
    if (Math.abs(a.punctuation.questionRate - b.punctuation.questionRate) > 0.1) {
      feedback.push(
        a.punctuation.questionRate > b.punctuation.questionRate
          ? 'Too many questions'
          : 'Consider adding rhetorical questions'
      );
    }
  }

  if (scores.vocabulary < threshold) {
    if (a.vocabulary.typeTokenRatio < b.vocabulary.typeTokenRatio - 0.1) {
      feedback.push('Vocabulary may be too repetitive');
    } else if (a.vocabulary.typeTokenRatio > b.vocabulary.typeTokenRatio + 0.1) {
      feedback.push('Vocabulary complexity exceeds typical range');
    }
  }

  if (scores.functionWords < threshold) {
    feedback.push('Function word usage pattern differs from established voice');
  }

  if (scores.syntactic < threshold) {
    if (a.syntactic.avgClauseDepth > b.syntactic.avgClauseDepth + 0.5) {
      feedback.push('Sentences may be too complex');
    } else if (a.syntactic.avgClauseDepth < b.syntactic.avgClauseDepth - 0.5) {
      feedback.push('Sentences may be too simple');
    }
  }

  return feedback;
}

export function compareSignatures(a: StyleSignature, b: StyleSignature): number {
  const result = compareSignaturesDetailed(a, b);
  return result.overallSimilarity;
}

export function compareSignaturesDetailed(
  a: StyleSignature,
  b: StyleSignature
): SignatureComparisonResult {
  const dimensionScores = {
    sentenceLength: compareSentenceLength(a, b),
    punctuation: comparePunctuation(a, b),
    vocabulary: compareVocabulary(a, b),
    functionWords: compareFunctionWords(a, b),
    syntactic: compareSyntactic(a, b),
  };

  const weights = getDimensionWeights();
  const overallSimilarity =
    dimensionScores.sentenceLength * weights.sentenceLength +
    dimensionScores.punctuation * weights.punctuation +
    dimensionScores.vocabulary * weights.vocabulary +
    dimensionScores.functionWords * weights.functionWords +
    dimensionScores.syntactic * weights.syntactic;

  const feedback = generateFeedback(a, b, dimensionScores);

  return {
    overallSimilarity: Math.round(overallSimilarity * 1000) / 1000,
    dimensionScores: {
      sentenceLength: Math.round(dimensionScores.sentenceLength * 1000) / 1000,
      punctuation: Math.round(dimensionScores.punctuation * 1000) / 1000,
      vocabulary: Math.round(dimensionScores.vocabulary * 1000) / 1000,
      functionWords: Math.round(dimensionScores.functionWords * 1000) / 1000,
      syntactic: Math.round(dimensionScores.syntactic * 1000) / 1000,
    },
    feedback,
  };
}

function averageSignatures(signatures: StyleSignature[]): StyleSignature {
  if (signatures.length === 0) {
    throw new Error('Cannot average empty signature array');
  }

  if (signatures.length === 1) {
    return { ...signatures[0] };
  }

  const count = signatures.length;
  const sum = (accessor: (s: StyleSignature) => number): number =>
    signatures.reduce((acc, s) => acc + accessor(s), 0) / count;

  return {
    sentenceLength: {
      mean: sum((s) => s.sentenceLength.mean),
      stdDev: sum((s) => s.sentenceLength.stdDev),
    },
    punctuation: {
      periodRate: sum((s) => s.punctuation.periodRate),
      commaRate: sum((s) => s.punctuation.commaRate),
      exclamationRate: sum((s) => s.punctuation.exclamationRate),
      questionRate: sum((s) => s.punctuation.questionRate),
      dashRate: sum((s) => s.punctuation.dashRate),
      ellipsisRate: sum((s) => s.punctuation.ellipsisRate),
    },
    vocabulary: {
      typeTokenRatio: sum((s) => s.vocabulary.typeTokenRatio),
      hapaxRatio: sum((s) => s.vocabulary.hapaxRatio),
    },
    functionWords: {
      the: sum((s) => s.functionWords.the),
      and: sum((s) => s.functionWords.and),
      but: sum((s) => s.functionWords.but),
      of: sum((s) => s.functionWords.of),
      to: sum((s) => s.functionWords.to),
      a: sum((s) => s.functionWords.a),
      in: sum((s) => s.functionWords.in),
      that: sum((s) => s.functionWords.that),
      is: sum((s) => s.functionWords.is),
      it: sum((s) => s.functionWords.it),
    },
    syntactic: {
      avgClauseDepth: sum((s) => s.syntactic.avgClauseDepth),
      avgWordsPerClause: sum((s) => s.syntactic.avgWordsPerClause),
      subordinateClauseRatio: sum((s) => s.syntactic.subordinateClauseRatio),
    },
    metadata: {
      textLength: 0,
      sampleCount: count,
      generatedAt: new Date().toISOString(),
    },
  };
}

async function fetchAllApprovedPostTexts(): Promise<string[]> {
  const exists = await collectionExists(QDRANT_COLLECTION_NAMES.APPROVED_POSTS);
  if (!exists) {
    logger.debug('approved_posts collection does not exist');
    return [];
  }

  const client = getQdrantClient();
  const texts: string[] = [];
  let offset: string | number | null | undefined = undefined;
  const batchSize = 100;
  let hasMore = true;

  while (hasMore) {
    const response = await client.scroll(QDRANT_COLLECTION_NAMES.APPROVED_POSTS, {
      limit: batchSize,
      offset: offset ?? undefined,
      with_payload: true,
      with_vector: false,
    });

    for (const point of response.points) {
      const text = (point.payload?.text as string) ?? '';
      if (text.length > 0) {
        texts.push(text);
      }
    }

    const nextOffset = response.next_page_offset;
    if (
      nextOffset !== null &&
      nextOffset !== undefined &&
      (typeof nextOffset === 'string' || typeof nextOffset === 'number')
    ) {
      offset = nextOffset;
    } else {
      hasMore = false;
    }
  }

  logger.debug(`Fetched ${texts.length} approved post texts for signature generation`);
  return texts;
}

export async function loadPersonaSignature(
  forceRefresh: boolean = false
): Promise<StyleSignature | null> {
  const now = Date.now();

  if (!forceRefresh && cachedPersonaSignature && now - cacheTimestamp < CACHE_TTL_MS) {
    logger.debug('Returning cached persona signature');
    return cachedPersonaSignature;
  }

  try {
    const texts = await fetchAllApprovedPostTexts();

    if (texts.length === 0) {
      logger.debug('No approved posts found, attempting to load baseline signature');
      const baseline = loadBaselineSignature();
      if (baseline) {
        cachedPersonaSignature = baseline;
        cacheTimestamp = now;
        logger.info('Using baseline signature from gold examples (no approved posts yet)');
        return baseline;
      }
      logger.warn('No approved posts and no baseline signature available');
      return null;
    }

    const signatures = texts.map((t) => generateSignature(t));
    const meanSignature = averageSignatures(signatures);

    cachedPersonaSignature = meanSignature;
    cacheTimestamp = now;

    logger.info(`Generated persona signature from ${texts.length} approved posts`);
    return meanSignature;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Failed to load persona signature', { error: message });
    return null;
  }
}

export function clearPersonaSignatureCache(): void {
  cachedPersonaSignature = null;
  cacheTimestamp = 0;
  logger.debug('Cleared persona signature cache');
}

export interface SignatureCacheStats {
  size: number;
  maxEntries: number;
  ttlMs: number;
}

export function getSignatureCacheStats(): SignatureCacheStats {
  return {
    size: signatureCache.size,
    maxEntries: SIGNATURE_CACHE_MAX_ENTRIES,
    ttlMs: SIGNATURE_CACHE_TTL_MS,
  };
}

export function clearSignatureCache(): void {
  signatureCache.clear();
  logger.debug('Cleared signature cache');
}

export function signatureToJson(signature: StyleSignature): string {
  return JSON.stringify(signature);
}

export function jsonToSignature(json: string): StyleSignature {
  return JSON.parse(json) as StyleSignature;
}

export function loadBaselineSignature(): StyleSignature | null {
  if (!fs.existsSync(BASELINE_SIGNATURE_PATH)) {
    logger.debug('No baseline signature file found');
    return null;
  }
  try {
    const content = fs.readFileSync(BASELINE_SIGNATURE_PATH, 'utf-8');
    const signature = JSON.parse(content) as StyleSignature;
    logger.debug('Loaded baseline signature from file');
    return signature;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn('Failed to load baseline signature file', { error: message });
    return null;
  }
}

export function saveBaselineSignatureToFile(signature: StyleSignature): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(BASELINE_SIGNATURE_PATH, JSON.stringify(signature, null, 2), 'utf-8');
  logger.info('Saved baseline signature to file');
}

export function hasBaselineSignature(): boolean {
  return fs.existsSync(BASELINE_SIGNATURE_PATH);
}

export interface DriftAnalysisResult {
  hasDrift: boolean;
  driftPercentage: number;
  threshold: number;
  recentPostsCount: number;
  recentSignature: StyleSignature | null;
  baselineSignature: StyleSignature | null;
  dimensionDrifts: {
    sentenceLength: number;
    punctuation: number;
    vocabulary: number;
    functionWords: number;
    syntactic: number;
  } | null;
  feedback: string[];
  alertLevel: 'none' | 'warning' | 'critical';
}

const DEFAULT_DRIFT_THRESHOLD = 0.15;
const RECENT_POSTS_COUNT = 20;

async function fetchRecentApprovedPostTexts(count: number): Promise<string[]> {
  const exists = await collectionExists(QDRANT_COLLECTION_NAMES.APPROVED_POSTS);
  if (!exists) {
    logger.debug('approved_posts collection does not exist');
    return [];
  }

  const client = getQdrantClient();
  const texts: string[] = [];

  const response = await client.scroll(QDRANT_COLLECTION_NAMES.APPROVED_POSTS, {
    limit: count,
    with_payload: true,
    with_vector: false,
    order_by: {
      key: 'created_at',
      direction: 'desc',
    },
  });

  for (const point of response.points) {
    const text = (point.payload?.text as string) ?? '';
    if (text.length > 0) {
      texts.push(text);
    }
  }

  logger.debug(`Fetched ${texts.length} recent approved posts for drift analysis`);
  return texts;
}

function calculateDimensionDrifts(
  recent: StyleSignature,
  baseline: StyleSignature
): DriftAnalysisResult['dimensionDrifts'] {
  const comparison = compareSignaturesDetailed(recent, baseline);
  return {
    sentenceLength: 1 - comparison.dimensionScores.sentenceLength,
    punctuation: 1 - comparison.dimensionScores.punctuation,
    vocabulary: 1 - comparison.dimensionScores.vocabulary,
    functionWords: 1 - comparison.dimensionScores.functionWords,
    syntactic: 1 - comparison.dimensionScores.syntactic,
  };
}

function generateDriftFeedback(
  dimensionDrifts: DriftAnalysisResult['dimensionDrifts'],
  recent: StyleSignature,
  baseline: StyleSignature
): string[] {
  if (!dimensionDrifts) return [];

  const feedback: string[] = [];
  const highDriftThreshold = 0.2;

  if (dimensionDrifts.sentenceLength > highDriftThreshold) {
    const recentMean = recent.sentenceLength.mean.toFixed(1);
    const baselineMean = baseline.sentenceLength.mean.toFixed(1);
    feedback.push(`Sentence length drifting (${recentMean} vs baseline ${baselineMean} words)`);
  }

  if (dimensionDrifts.punctuation > highDriftThreshold) {
    feedback.push('Punctuation patterns shifting from baseline');
  }

  if (dimensionDrifts.vocabulary > highDriftThreshold) {
    const recentTTR = (recent.vocabulary.typeTokenRatio * 100).toFixed(0);
    const baselineTTR = (baseline.vocabulary.typeTokenRatio * 100).toFixed(0);
    feedback.push(`Vocabulary richness drifting (${recentTTR}% vs baseline ${baselineTTR}%)`);
  }

  if (dimensionDrifts.functionWords > highDriftThreshold) {
    feedback.push('Function word usage pattern diverging from baseline');
  }

  if (dimensionDrifts.syntactic > highDriftThreshold) {
    feedback.push('Syntactic complexity changing from baseline style');
  }

  return feedback;
}

function determineAlertLevel(
  driftPercentage: number,
  threshold: number
): DriftAnalysisResult['alertLevel'] {
  if (driftPercentage < threshold) return 'none';
  if (driftPercentage < threshold * 1.5) return 'warning';
  return 'critical';
}

export async function checkStylometricDrift(
  options: {
    threshold?: number;
    recentPostsCount?: number;
  } = {}
): Promise<DriftAnalysisResult> {
  const threshold = options.threshold ?? DEFAULT_DRIFT_THRESHOLD;
  const count = options.recentPostsCount ?? RECENT_POSTS_COUNT;

  const baseline = loadBaselineSignature();
  if (!baseline) {
    logger.warn('No baseline signature available for drift detection');
    return {
      hasDrift: false,
      driftPercentage: 0,
      threshold,
      recentPostsCount: 0,
      recentSignature: null,
      baselineSignature: null,
      dimensionDrifts: null,
      feedback: ['No baseline signature available for comparison'],
      alertLevel: 'none',
    };
  }

  const recentTexts = await fetchRecentApprovedPostTexts(count);
  if (recentTexts.length < 5) {
    logger.debug('Not enough recent posts for drift detection', { count: recentTexts.length });
    return {
      hasDrift: false,
      driftPercentage: 0,
      threshold,
      recentPostsCount: recentTexts.length,
      recentSignature: null,
      baselineSignature: baseline,
      dimensionDrifts: null,
      feedback: [`Only ${recentTexts.length} recent posts (need at least 5 for drift analysis)`],
      alertLevel: 'none',
    };
  }

  const recentSignatures = recentTexts.map((t) => generateSignature(t));
  const recentSignature = averageSignatures(recentSignatures);
  const similarity = compareSignatures(recentSignature, baseline);
  const driftPercentage = Math.round((1 - similarity) * 1000) / 1000;

  const dimensionDrifts = calculateDimensionDrifts(recentSignature, baseline);
  const feedback = generateDriftFeedback(dimensionDrifts, recentSignature, baseline);
  const alertLevel = determineAlertLevel(driftPercentage, threshold);
  const hasDrift = driftPercentage >= threshold;

  if (hasDrift) {
    logger.warn('Stylometric drift detected', {
      driftPercentage,
      threshold,
      alertLevel,
      dimensionDrifts,
    });
  } else {
    logger.debug('No significant stylometric drift', { driftPercentage, threshold });
  }

  return {
    hasDrift,
    driftPercentage,
    threshold,
    recentPostsCount: recentTexts.length,
    recentSignature,
    baselineSignature: baseline,
    dimensionDrifts,
    feedback,
    alertLevel,
  };
}

export { DEFAULT_DRIFT_THRESHOLD, RECENT_POSTS_COUNT };
