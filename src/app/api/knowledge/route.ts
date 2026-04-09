import { NextResponse } from 'next/server';
import { listPatterns, countPatterns } from '@/db/models/patterns';
import { countFeedback } from '@/db/models/feedback';
import { listAccounts } from '@/db/models/accounts';
import { listSources } from '@/db/models/sources';
import { checkForContradictions } from '@/lib/learning/contradictions';
import type { PatternType } from '@/types';
import { PATTERN_WEIGHT_EDIT, PATTERN_WEIGHT_REJECTION } from '@/types';

interface StoredPatternResponse {
  id: number;
  type: PatternType;
  description: string;
  evidenceCount: number;
  editEvidenceCount: number;
  rejectionEvidenceCount: number;
  weightedScore: number;
  createdAt: string;
  updatedAt: string;
}

interface PatternStatsResponse {
  total: number;
  byType: Record<PatternType, number>;
  highConfidence: number;
  lowConfidence: number;
  avgEvidenceCount: number;
  totalEditEvidence: number;
  totalRejectionEvidence: number;
  avgWeightedScore: number;
}

interface ContradictionResponse {
  patternA: { id?: number; description: string; evidenceCount: number };
  patternB: { id?: number; description: string; evidenceCount: number };
  contradictionType: string;
  severity: 'high' | 'medium' | 'low';
  explanation: string;
}

interface FeedbackStatsResponse {
  total: number;
  approvals: number;
  rejections: number;
  edits: number;
}

interface SourceAccountResponse {
  handle: string;
  tier: number;
  contribution: number;
}

interface KnowledgeBaseResponse {
  patterns: StoredPatternResponse[];
  stats: PatternStatsResponse;
  contradictions: ContradictionResponse[];
  feedbackStats: FeedbackStatsResponse;
  sourceAccounts: SourceAccountResponse[];
}

function calculateWeightedScore(editEvidence: number, rejectionEvidence: number): number {
  return editEvidence * PATTERN_WEIGHT_EDIT + rejectionEvidence * PATTERN_WEIGHT_REJECTION;
}

export function GET(): NextResponse<KnowledgeBaseResponse> {
  const allPatterns = listPatterns({ limit: 500, orderBy: 'evidence_count', orderDir: 'desc' });

  const patterns: StoredPatternResponse[] = allPatterns.map((p) => ({
    id: p.id,
    type: p.patternType,
    description: p.description,
    evidenceCount: p.evidenceCount,
    editEvidenceCount: p.editEvidenceCount,
    rejectionEvidenceCount: p.rejectionEvidenceCount,
    weightedScore: calculateWeightedScore(p.editEvidenceCount, p.rejectionEvidenceCount),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  }));

  const byType: Record<PatternType, number> = {
    voice: countPatterns({ patternType: 'voice' }),
    hook: countPatterns({ patternType: 'hook' }),
    topic: countPatterns({ patternType: 'topic' }),
    rejection: countPatterns({ patternType: 'rejection' }),
    edit: countPatterns({ patternType: 'edit' }),
  };

  let totalEvidence = 0;
  let totalEditEvidence = 0;
  let totalRejectionEvidence = 0;
  let totalWeightedScore = 0;
  let highConfidence = 0;
  let lowConfidence = 0;

  for (const p of patterns) {
    totalEvidence += p.evidenceCount;
    totalEditEvidence += p.editEvidenceCount;
    totalRejectionEvidence += p.rejectionEvidenceCount;
    totalWeightedScore += p.weightedScore;

    if (p.weightedScore >= 10 || p.editEvidenceCount >= 3) {
      highConfidence++;
    } else if (p.weightedScore <= 1) {
      lowConfidence++;
    }
  }

  const stats: PatternStatsResponse = {
    total: patterns.length,
    byType,
    highConfidence,
    lowConfidence,
    avgEvidenceCount: patterns.length > 0 ? totalEvidence / patterns.length : 0,
    totalEditEvidence,
    totalRejectionEvidence,
    avgWeightedScore: patterns.length > 0 ? totalWeightedScore / patterns.length : 0,
  };

  const contradictionResult = checkForContradictions({ minEvidenceToConsider: 1 });
  const contradictions: ContradictionResponse[] = contradictionResult.contradictions.map((c) => ({
    patternA: {
      id: c.patternA.id,
      description: c.patternA.description,
      evidenceCount: c.patternA.evidenceCount,
    },
    patternB: {
      id: c.patternB.id,
      description: c.patternB.description,
      evidenceCount: c.patternB.evidenceCount,
    },
    contradictionType: c.contradictionType,
    severity: c.severity,
    explanation: c.explanation,
  }));

  const feedbackStats: FeedbackStatsResponse = {
    total: countFeedback({}),
    approvals: countFeedback({ action: 'approve' }),
    rejections: countFeedback({ action: 'reject' }),
    edits: countFeedback({ action: 'edit' }),
  };

  const accounts = listAccounts({ limit: 200 });
  const sources = listSources({ limit: 1000 });

  const accountContributions = new Map<string, number>();
  for (const source of sources) {
    const handle = source.metadata.authorHandle;
    if (handle) {
      accountContributions.set(handle, (accountContributions.get(handle) ?? 0) + 1);
    }
  }

  const sourceAccounts: SourceAccountResponse[] = accounts
    .map((a) => ({
      handle: a.handle,
      tier: a.tier,
      contribution: accountContributions.get(a.handle) ?? 0,
    }))
    .filter((a) => a.contribution > 0)
    .sort((a, b) => b.contribution - a.contribution);

  return NextResponse.json({
    patterns,
    stats,
    contradictions,
    feedbackStats,
    sourceAccounts,
  });
}
