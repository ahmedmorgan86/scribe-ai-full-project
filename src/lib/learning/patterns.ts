import type { Pattern, PatternEvidenceSource, PatternStatus, PatternType } from '@/types';
import { PATTERN_WEIGHT_EDIT, PATTERN_WEIGHT_REJECTION } from '@/types';
import {
  createPattern,
  deletePattern,
  getPatternById,
  incrementEvidenceBySource,
  incrementEvidenceCount,
  listPatterns,
  updatePattern,
} from '@/db/models/patterns';
import { updatePatternAccess } from './decay';

export interface StoredPattern {
  id: number;
  type: PatternType;
  description: string;
  evidenceCount: number;
  editEvidenceCount: number;
  rejectionEvidenceCount: number;
  lastAccessedAt: string | null;
  accessCount: number;
  decayScore: number;
  status: PatternStatus;
  weightedScore: number;
  createdAt: string;
  updatedAt: string;
}

export interface PatternMatch {
  pattern: StoredPattern;
  similarity: number;
  isExact: boolean;
}

export interface PatternRetrievalOptions {
  types?: PatternType[];
  minEvidenceCount?: number;
  limit?: number;
}

export interface PatternStorageResult {
  patternId: number;
  action: 'created' | 'reinforced' | 'duplicate';
  existingPatternId?: number;
}

const SIMILARITY_THRESHOLD = 0.5;
const DEFAULT_MIN_EVIDENCE_FOR_GENERATION = 2;
const STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'could',
  'should',
  'may',
  'might',
  'must',
  'shall',
  'can',
  'of',
  'to',
  'in',
  'for',
  'on',
  'with',
  'at',
  'by',
  'from',
  'as',
  'into',
  'about',
  'like',
  'through',
  'after',
  'over',
  'between',
  'out',
  'against',
  'during',
  'without',
  'before',
  'under',
  'around',
  'among',
  'and',
  'but',
  'or',
  'nor',
  'so',
  'yet',
  'both',
  'either',
  'neither',
  'not',
  'only',
  'own',
  'same',
  'than',
  'too',
  'very',
  'just',
  'that',
  'this',
  'these',
  'those',
  'it',
  'its',
]);

function calculateWeightedScore(pattern: Pattern): number {
  return (
    pattern.editEvidenceCount * PATTERN_WEIGHT_EDIT +
    pattern.rejectionEvidenceCount * PATTERN_WEIGHT_REJECTION
  );
}

function patternToStored(pattern: Pattern): StoredPattern {
  return {
    id: pattern.id,
    type: pattern.patternType,
    description: pattern.description,
    evidenceCount: pattern.evidenceCount,
    editEvidenceCount: pattern.editEvidenceCount,
    rejectionEvidenceCount: pattern.rejectionEvidenceCount,
    lastAccessedAt: pattern.lastAccessedAt,
    accessCount: pattern.accessCount,
    decayScore: pattern.decayScore,
    status: pattern.status,
    weightedScore: calculateWeightedScore(pattern),
    createdAt: pattern.createdAt,
    updatedAt: pattern.updatedAt,
  };
}

function extractKeywords(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  return new Set(words);
}

function calculateJaccardSimilarity(text1: string, text2: string): number {
  const words1 = extractKeywords(text1);
  const words2 = extractKeywords(text2);

  if (words1.size === 0 && words2.size === 0) {
    return 1;
  }
  if (words1.size === 0 || words2.size === 0) {
    return 0;
  }

  const intersection = [...words1].filter((w) => words2.has(w));
  const union = new Set([...words1, ...words2]);

  return intersection.length / union.size;
}

export function findSimilarPatterns(
  description: string,
  patternType: PatternType,
  threshold: number = SIMILARITY_THRESHOLD
): PatternMatch[] {
  const existingPatterns = listPatterns({ patternType, limit: 500 });
  const matches: PatternMatch[] = [];

  for (const pattern of existingPatterns) {
    const similarity = calculateJaccardSimilarity(description, pattern.description);
    const isExact = description.toLowerCase().trim() === pattern.description.toLowerCase().trim();

    if (similarity >= threshold || isExact) {
      matches.push({
        pattern: patternToStored(pattern),
        similarity,
        isExact,
      });
    }
  }

  return matches.sort((a, b) => b.similarity - a.similarity);
}

export function storePattern(
  description: string,
  patternType: PatternType,
  evidenceCount: number = 1,
  evidenceSource?: PatternEvidenceSource
): PatternStorageResult {
  const similarPatterns = findSimilarPatterns(description, patternType);

  if (similarPatterns.length > 0) {
    const bestMatch = similarPatterns[0];

    if (bestMatch.isExact) {
      if (evidenceSource) {
        incrementEvidenceBySource(bestMatch.pattern.id, evidenceSource);
      }
      return {
        patternId: bestMatch.pattern.id,
        action: 'duplicate',
        existingPatternId: bestMatch.pattern.id,
      };
    }

    if (evidenceSource) {
      incrementEvidenceBySource(bestMatch.pattern.id, evidenceSource);
    } else {
      incrementEvidenceCount(bestMatch.pattern.id);
    }
    return {
      patternId: bestMatch.pattern.id,
      action: 'reinforced',
      existingPatternId: bestMatch.pattern.id,
    };
  }

  const newPattern = createPattern({
    patternType,
    description,
    evidenceCount,
    editEvidenceCount: evidenceSource === 'edit' ? 1 : 0,
    rejectionEvidenceCount: evidenceSource === 'rejection' ? 1 : 0,
  });

  return {
    patternId: newPattern.id,
    action: 'created',
  };
}

export function storePatternsBatch(
  patterns: {
    description: string;
    type: PatternType;
    evidenceCount?: number;
    evidenceSource?: PatternEvidenceSource;
  }[]
): { created: number; reinforced: number; duplicate: number } {
  let created = 0;
  let reinforced = 0;
  let duplicate = 0;

  for (const pattern of patterns) {
    const result = storePattern(
      pattern.description,
      pattern.type,
      pattern.evidenceCount ?? 1,
      pattern.evidenceSource
    );
    switch (result.action) {
      case 'created':
        created++;
        break;
      case 'reinforced':
        reinforced++;
        break;
      case 'duplicate':
        duplicate++;
        break;
    }
  }

  return { created, reinforced, duplicate };
}

export function getPatternsForGeneration(options: PatternRetrievalOptions = {}): StoredPattern[] {
  const {
    types = ['voice', 'hook', 'topic', 'edit'],
    minEvidenceCount = DEFAULT_MIN_EVIDENCE_FOR_GENERATION,
    limit = 50,
  } = options;

  const allPatterns: StoredPattern[] = [];

  for (const patternType of types) {
    const patterns = listPatterns({
      patternType,
      minEvidenceCount,
      limit: Math.ceil(limit / types.length) * 2,
      orderBy: 'decay_score',
      orderDir: 'desc',
    });
    allPatterns.push(...patterns.map(patternToStored));
  }

  // Sort by decay score (primary) then weighted score (secondary)
  const sortedPatterns = allPatterns
    .sort((a, b) => {
      const decayDiff = b.decayScore - a.decayScore;
      if (Math.abs(decayDiff) > 0.001) return decayDiff;
      return b.weightedScore - a.weightedScore;
    })
    .slice(0, limit);

  // Update access tracking for retrieved patterns
  for (const pattern of sortedPatterns) {
    updatePatternAccess(pattern.id);
  }

  return sortedPatterns;
}

export function getPatternsByTypeForGeneration(
  patternType: PatternType,
  minEvidenceCount: number = DEFAULT_MIN_EVIDENCE_FOR_GENERATION
): StoredPattern[] {
  const patterns = listPatterns({
    patternType,
    minEvidenceCount,
    orderBy: 'evidence_count',
    orderDir: 'desc',
    limit: 20,
  });
  return patterns.map(patternToStored);
}

export function getRejectionPatterns(minEvidenceCount: number = 2): StoredPattern[] {
  const patterns = listPatterns({
    patternType: 'rejection',
    minEvidenceCount,
    orderBy: 'evidence_count',
    orderDir: 'desc',
    limit: 50,
  });
  return patterns.map(patternToStored);
}

export function getVoicePatterns(minEvidenceCount: number = 2): StoredPattern[] {
  const patterns = listPatterns({
    patternType: 'voice',
    minEvidenceCount,
    orderBy: 'evidence_count',
    orderDir: 'desc',
    limit: 30,
  });
  return patterns.map(patternToStored);
}

export function getEditPatterns(minEvidenceCount: number = 2): StoredPattern[] {
  const patterns = listPatterns({
    patternType: 'edit',
    minEvidenceCount,
    orderBy: 'evidence_count',
    orderDir: 'desc',
    limit: 30,
  });
  return patterns.map(patternToStored);
}

export function reinforcePattern(
  patternId: number,
  evidenceSource?: PatternEvidenceSource
): StoredPattern | null {
  const updated = evidenceSource
    ? incrementEvidenceBySource(patternId, evidenceSource)
    : incrementEvidenceCount(patternId);
  return updated ? patternToStored(updated) : null;
}

export function removePattern(patternId: number): boolean {
  return deletePattern(patternId);
}

export function getPatternDetails(patternId: number): StoredPattern | null {
  const pattern = getPatternById(patternId);
  return pattern ? patternToStored(pattern) : null;
}

export function updatePatternDescription(
  patternId: number,
  newDescription: string
): StoredPattern | null {
  const updated = updatePattern(patternId, { description: newDescription });
  return updated ? patternToStored(updated) : null;
}

export interface PatternStats {
  total: number;
  byType: Record<PatternType, number>;
  highConfidence: number;
  lowConfidence: number;
  avgEvidenceCount: number;
  totalEditEvidence: number;
  totalRejectionEvidence: number;
  avgWeightedScore: number;
}

export function getPatternStats(): PatternStats {
  const allPatterns = listPatterns({ limit: 1000 });

  const byType: Record<PatternType, number> = {
    voice: 0,
    hook: 0,
    topic: 0,
    rejection: 0,
    edit: 0,
  };

  let totalEvidence = 0;
  let totalEditEvidence = 0;
  let totalRejectionEvidence = 0;
  let totalWeightedScore = 0;
  let highConfidence = 0;
  let lowConfidence = 0;

  for (const pattern of allPatterns) {
    byType[pattern.patternType]++;
    totalEvidence += pattern.evidenceCount;
    totalEditEvidence += pattern.editEvidenceCount;
    totalRejectionEvidence += pattern.rejectionEvidenceCount;
    const stored = patternToStored(pattern);
    totalWeightedScore += stored.weightedScore;

    if (stored.weightedScore >= 10 || pattern.editEvidenceCount >= 3) {
      highConfidence++;
    } else if (stored.weightedScore <= 1) {
      lowConfidence++;
    }
  }

  return {
    total: allPatterns.length,
    byType,
    highConfidence,
    lowConfidence,
    avgEvidenceCount: allPatterns.length > 0 ? totalEvidence / allPatterns.length : 0,
    totalEditEvidence,
    totalRejectionEvidence,
    avgWeightedScore: allPatterns.length > 0 ? totalWeightedScore / allPatterns.length : 0,
  };
}

function getConfidenceLabel(pattern: StoredPattern): string {
  if (pattern.editEvidenceCount >= 3) {
    return 'high (edit-verified)';
  }
  if (pattern.weightedScore >= 10) {
    return 'high';
  }
  if (pattern.weightedScore >= 5 || pattern.editEvidenceCount >= 1) {
    return 'medium';
  }
  return 'low';
}

export function formatPatternsForPrompt(patterns: StoredPattern[]): string {
  if (patterns.length === 0) {
    return 'No learned patterns yet.';
  }

  const lines: string[] = ['## Learned Patterns', ''];

  const grouped = new Map<PatternType, StoredPattern[]>();
  for (const pattern of patterns) {
    const list = grouped.get(pattern.type) ?? [];
    list.push(pattern);
    grouped.set(pattern.type, list);
  }

  const typeLabels: Record<PatternType, string> = {
    voice: 'Voice Preferences',
    hook: 'Hook Patterns',
    topic: 'Topic Preferences',
    rejection: 'Things to Avoid',
    edit: 'Edit Preferences',
  };

  for (const [type, typePatterns] of grouped) {
    lines.push(`### ${typeLabels[type]}`);
    const sortedPatterns = typePatterns.sort((a, b) => b.weightedScore - a.weightedScore);
    for (const pattern of sortedPatterns) {
      lines.push(`- ${pattern.description} (${getConfidenceLabel(pattern)} confidence)`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function formatPatternStats(stats: PatternStats): string {
  const lines: string[] = [];

  lines.push('=== Pattern Statistics ===');
  lines.push(`Total patterns: ${stats.total}`);
  lines.push(`Average evidence count: ${stats.avgEvidenceCount.toFixed(1)}`);
  lines.push(`Average weighted score: ${stats.avgWeightedScore.toFixed(1)}`);
  lines.push(`High confidence patterns: ${stats.highConfidence}`);
  lines.push(`Low confidence patterns: ${stats.lowConfidence}`);
  lines.push('');
  lines.push('Evidence breakdown:');
  lines.push(`  From edits: ${stats.totalEditEvidence} (weight ${PATTERN_WEIGHT_EDIT}x)`);
  lines.push(
    `  From rejections: ${stats.totalRejectionEvidence} (weight ${PATTERN_WEIGHT_REJECTION}x)`
  );
  lines.push('');
  lines.push('By type:');
  for (const [type, count] of Object.entries(stats.byType)) {
    lines.push(`  ${type}: ${count}`);
  }

  return lines.join('\n');
}

export function pruneWeakPatterns(maxAge: number = 30, maxEvidenceCount: number = 1): number {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - maxAge);
  const cutoffStr = cutoffDate.toISOString();

  const allPatterns = listPatterns({ limit: 1000 });
  let removed = 0;

  for (const pattern of allPatterns) {
    if (pattern.evidenceCount <= maxEvidenceCount && pattern.createdAt < cutoffStr) {
      if (deletePattern(pattern.id)) {
        removed++;
      }
    }
  }

  return removed;
}

export function mergePatterns(
  patternIds: number[],
  mergedDescription: string
): StoredPattern | null {
  if (patternIds.length < 2) {
    return null;
  }

  const patterns = patternIds.map(getPatternById).filter((p): p is Pattern => p !== null);
  if (patterns.length < 2) {
    return null;
  }

  const types = new Set(patterns.map((p) => p.patternType));
  if (types.size > 1) {
    return null;
  }

  const totalEvidence = patterns.reduce((sum, p) => sum + p.evidenceCount, 0);
  const patternType = patterns[0].patternType;

  const newPattern = createPattern({
    patternType,
    description: mergedDescription,
    evidenceCount: totalEvidence,
  });

  for (const id of patternIds) {
    deletePattern(id);
  }

  return patternToStored(newPattern);
}
