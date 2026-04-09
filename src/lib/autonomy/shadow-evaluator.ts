import { getDb } from '@/db/connection';
import type { VoiceScore } from '@/types';
import { getPatternsForGeneration } from '@/lib/learning/patterns';

export type AiDecision = 'approve' | 'reject' | 'needs_edit';

export interface ShadowEvaluationInput {
  postId: number;
  content: string;
  voiceScore?: VoiceScore | null;
  patternsUsed?: number[];
}

export interface ShadowEvaluationResult {
  decision: AiDecision;
  confidence: number;
  factors: {
    voiceScore: number;
    patternScore: number;
    decayScore: number;
    consistencyScore: number;
  };
  reasoning: string[];
}

const APPROVAL_THRESHOLD = 0.75;
const EDIT_THRESHOLD = 0.5;

/**
 * Calculates a confidence score based on voice evaluation.
 */
function calculateVoiceConfidence(voiceScore: VoiceScore | null): number {
  if (!voiceScore) return 0.5;

  // Normalize overall score from 0-100 to 0-1
  return voiceScore.overall / 100;
}

/**
 * Calculates a score based on pattern matching.
 */
function calculatePatternScore(patternsUsed: number[]): number {
  if (patternsUsed.length === 0) return 0.5;

  const allPatterns = getPatternsForGeneration({ limit: 100 });
  const usedPatterns = allPatterns.filter((p) => patternsUsed.includes(p.id));

  if (usedPatterns.length === 0) return 0.5;

  // Average decay score of used patterns
  const avgDecay = usedPatterns.reduce((sum, p) => sum + p.decayScore, 0) / usedPatterns.length;

  // Normalize evidence count (more evidence = higher confidence)
  const maxEvidence = Math.max(...usedPatterns.map((p) => p.evidenceCount), 1);
  const avgEvidence =
    usedPatterns.reduce((sum, p) => sum + p.evidenceCount, 0) / usedPatterns.length;
  const evidenceScore = Math.min(avgEvidence / maxEvidence, 1);

  return avgDecay * 0.6 + evidenceScore * 0.4;
}

/**
 * Calculates average decay score from patterns.
 */
function calculateDecayScore(patternsUsed: number[]): number {
  if (patternsUsed.length === 0) return 0.5;

  const allPatterns = getPatternsForGeneration({ limit: 100 });
  const usedPatterns = allPatterns.filter((p) => patternsUsed.includes(p.id));

  if (usedPatterns.length === 0) return 0.5;

  return usedPatterns.reduce((sum, p) => sum + p.decayScore, 0) / usedPatterns.length;
}

/**
 * Calculates consistency with recent approved posts.
 */
function calculateConsistencyScore(_content: string): number {
  // Simplified: Check how many recent approved posts exist
  const db = getDb();
  const stmt = db.prepare(`
    SELECT COUNT(*) as count FROM posts
    WHERE status = 'approved'
    AND created_at > datetime('now', '-7 days')
  `);
  const result = stmt.get() as { count: number };

  // More approved posts in last 7 days = higher consistency baseline
  const recentApprovals = result.count;
  if (recentApprovals >= 10) return 0.8;
  if (recentApprovals >= 5) return 0.7;
  if (recentApprovals >= 1) return 0.6;
  return 0.5;
}

/**
 * Evaluates a post in shadow mode - makes AI decision without acting on it.
 */
export function evaluateShadow(input: ShadowEvaluationInput): ShadowEvaluationResult {
  const voiceConfidence = calculateVoiceConfidence(input.voiceScore ?? null);
  const patternScore = calculatePatternScore(input.patternsUsed ?? []);
  const decayScore = calculateDecayScore(input.patternsUsed ?? []);
  const consistencyScore = calculateConsistencyScore(input.content);

  // Weighted combination
  const overallConfidence =
    voiceConfidence * 0.4 + patternScore * 0.25 + decayScore * 0.2 + consistencyScore * 0.15;

  const reasoning: string[] = [];

  // Build reasoning
  if (voiceConfidence >= 0.7) {
    reasoning.push('Strong voice consistency');
  } else if (voiceConfidence < 0.5) {
    reasoning.push('Voice score below acceptable threshold');
  }

  if (patternScore >= 0.7) {
    reasoning.push('Uses well-established patterns');
  } else if (patternScore < 0.5) {
    reasoning.push('Pattern confidence is low');
  }

  if (decayScore >= 0.7) {
    reasoning.push('Patterns have strong recent usage');
  } else if (decayScore < 0.3) {
    reasoning.push('Patterns may be stale');
  }

  // Make decision
  let decision: AiDecision;
  if (overallConfidence >= APPROVAL_THRESHOLD) {
    decision = 'approve';
    reasoning.push(
      `Confidence ${(overallConfidence * 100).toFixed(1)}% exceeds approval threshold`
    );
  } else if (overallConfidence >= EDIT_THRESHOLD) {
    decision = 'needs_edit';
    reasoning.push(
      `Confidence ${(overallConfidence * 100).toFixed(1)}% suggests human editing needed`
    );
  } else {
    decision = 'reject';
    reasoning.push(
      `Confidence ${(overallConfidence * 100).toFixed(1)}% below acceptable threshold`
    );
  }

  return {
    decision,
    confidence: overallConfidence,
    factors: {
      voiceScore: voiceConfidence,
      patternScore,
      decayScore,
      consistencyScore,
    },
    reasoning,
  };
}

/**
 * Records shadow evaluation result in database.
 */
export function recordShadowEvaluation(postId: number, result: ShadowEvaluationResult): void {
  const db = getDb();
  const stmt = db.prepare(`
    UPDATE posts SET ai_decision = ?, ai_confidence = ? WHERE id = ?
  `);
  stmt.run(result.decision, result.confidence, postId);
}

/**
 * Gets shadow evaluation stats for monitoring.
 */
export function getShadowStats(since?: Date): {
  total: number;
  byDecision: Record<AiDecision, number>;
  avgConfidence: number;
  agreementRate: number | null;
} {
  const db = getDb();
  const sinceStr = since?.toISOString() ?? '1970-01-01';

  // Get all posts with AI decisions
  const stmt = db.prepare(`
    SELECT ai_decision, ai_confidence, status
    FROM posts
    WHERE ai_decision IS NOT NULL
    AND created_at >= ?
  `);
  const rows = stmt.all(sinceStr) as Array<{
    ai_decision: string;
    ai_confidence: number;
    status: string;
  }>;

  if (rows.length === 0) {
    return {
      total: 0,
      byDecision: { approve: 0, reject: 0, needs_edit: 0 },
      avgConfidence: 0,
      agreementRate: null,
    };
  }

  const byDecision: Record<AiDecision, number> = {
    approve: 0,
    reject: 0,
    needs_edit: 0,
  };

  let totalConfidence = 0;
  let agreements = 0;
  let comparableDecisions = 0;

  for (const row of rows) {
    const decision = row.ai_decision as AiDecision;
    byDecision[decision]++;
    totalConfidence += row.ai_confidence;

    // Compare AI decision with human decision
    // approve <-> approved, reject <-> rejected
    if (row.status === 'approved' || row.status === 'rejected') {
      comparableDecisions++;
      if (
        (decision === 'approve' && row.status === 'approved') ||
        (decision === 'reject' && row.status === 'rejected')
      ) {
        agreements++;
      }
    }
  }

  return {
    total: rows.length,
    byDecision,
    avgConfidence: totalConfidence / rows.length,
    agreementRate: comparableDecisions > 0 ? agreements / comparableDecisions : null,
  };
}
