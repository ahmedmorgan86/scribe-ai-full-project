import { NextResponse } from 'next/server';
import { getDb } from '@/db/connection';
import type { StyleSignatureData } from '@/types';
import { loadBaselineSignature, checkStylometricDrift } from '@/lib/voice/signature';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api:analytics-stylometric');

interface PostWithSignature {
  id: number;
  created_at: string;
  stylometric_signature: string | null;
}

interface TimeSeriesPoint {
  date: string;
  value: number;
}

interface StylometricTrends {
  sentenceLength: TimeSeriesPoint[];
  vocabularyRichness: TimeSeriesPoint[];
  punctuation: {
    period: TimeSeriesPoint[];
    comma: TimeSeriesPoint[];
    exclamation: TimeSeriesPoint[];
    question: TimeSeriesPoint[];
  };
}

interface VoiceHealthStatus {
  status: 'healthy' | 'warning' | 'critical' | 'unknown' | 'no_data';
  score: number | null;
  driftPercentage: number | null;
  threshold: number;
  issues: string[];
}

interface CurrentMetrics {
  avgSentenceLength: number | null;
  avgVocabularyRichness: number | null;
  avgPunctuationPeriod: number | null;
  avgPunctuationComma: number | null;
  avgPunctuationExclamation: number | null;
  avgPunctuationQuestion: number | null;
  sampleCount: number;
}

interface BaselineComparison {
  sentenceLength: { current: number | null; baseline: number | null; diff: number | null };
  vocabularyRichness: { current: number | null; baseline: number | null; diff: number | null };
  punctuationPeriod: { current: number | null; baseline: number | null; diff: number | null };
}

export interface StylometricAnalyticsResponse {
  trends: StylometricTrends;
  current: CurrentMetrics;
  baseline: BaselineComparison;
  voiceHealth: VoiceHealthStatus;
  postsWithSignatures: number;
  totalApprovedPosts: number;
}

function getRecentPostsWithSignatures(days: number): PostWithSignature[] {
  const db = getDb();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  const stmt = db.prepare(`
    SELECT id, created_at, stylometric_signature
    FROM posts
    WHERE status = 'approved'
      AND stylometric_signature IS NOT NULL
      AND created_at >= ?
    ORDER BY created_at ASC
  `);

  return stmt.all(cutoffDate.toISOString()) as PostWithSignature[];
}

function parseSignature(json: string | null): StyleSignatureData | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as StyleSignatureData;
  } catch {
    return null;
  }
}

function groupByDate(
  posts: PostWithSignature[],
  extractor: (sig: StyleSignatureData) => number
): TimeSeriesPoint[] {
  const grouped = new Map<string, number[]>();

  for (const post of posts) {
    const sig = parseSignature(post.stylometric_signature);
    if (!sig) continue;

    const date = post.created_at.split('T')[0];
    const value = extractor(sig);

    const existing = grouped.get(date);
    if (existing) {
      existing.push(value);
    } else {
      grouped.set(date, [value]);
    }
  }

  return Array.from(grouped.entries())
    .map(([date, values]) => ({
      date,
      value: Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 1000) / 1000,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function calculateTrends(posts: PostWithSignature[]): StylometricTrends {
  return {
    sentenceLength: groupByDate(posts, (sig) => sig.sentenceLength.mean),
    vocabularyRichness: groupByDate(posts, (sig) => sig.vocabulary.typeTokenRatio),
    punctuation: {
      period: groupByDate(posts, (sig) => sig.punctuation.periodRate),
      comma: groupByDate(posts, (sig) => sig.punctuation.commaRate),
      exclamation: groupByDate(posts, (sig) => sig.punctuation.exclamationRate),
      question: groupByDate(posts, (sig) => sig.punctuation.questionRate),
    },
  };
}

function calculateCurrentMetrics(posts: PostWithSignature[]): CurrentMetrics {
  const recentPosts = posts.slice(-20);
  const signatures = recentPosts
    .map((p) => parseSignature(p.stylometric_signature))
    .filter((s): s is StyleSignatureData => s !== null);

  if (signatures.length === 0) {
    return {
      avgSentenceLength: null,
      avgVocabularyRichness: null,
      avgPunctuationPeriod: null,
      avgPunctuationComma: null,
      avgPunctuationExclamation: null,
      avgPunctuationQuestion: null,
      sampleCount: 0,
    };
  }

  const avg = (arr: number[]): number => arr.reduce((a, b) => a + b, 0) / arr.length;

  return {
    avgSentenceLength: Math.round(avg(signatures.map((s) => s.sentenceLength.mean)) * 100) / 100,
    avgVocabularyRichness:
      Math.round(avg(signatures.map((s) => s.vocabulary.typeTokenRatio)) * 1000) / 1000,
    avgPunctuationPeriod:
      Math.round(avg(signatures.map((s) => s.punctuation.periodRate)) * 1000) / 1000,
    avgPunctuationComma:
      Math.round(avg(signatures.map((s) => s.punctuation.commaRate)) * 1000) / 1000,
    avgPunctuationExclamation:
      Math.round(avg(signatures.map((s) => s.punctuation.exclamationRate)) * 1000) / 1000,
    avgPunctuationQuestion:
      Math.round(avg(signatures.map((s) => s.punctuation.questionRate)) * 1000) / 1000,
    sampleCount: signatures.length,
  };
}

function calculateBaselineComparison(
  current: CurrentMetrics,
  baseline: StyleSignatureData | null
): BaselineComparison {
  const diff = (c: number | null, b: number | null): number | null =>
    c !== null && b !== null ? Math.round((c - b) * 1000) / 1000 : null;

  return {
    sentenceLength: {
      current: current.avgSentenceLength,
      baseline: baseline?.sentenceLength.mean ?? null,
      diff: diff(current.avgSentenceLength, baseline?.sentenceLength.mean ?? null),
    },
    vocabularyRichness: {
      current: current.avgVocabularyRichness,
      baseline: baseline?.vocabulary.typeTokenRatio ?? null,
      diff: diff(current.avgVocabularyRichness, baseline?.vocabulary.typeTokenRatio ?? null),
    },
    punctuationPeriod: {
      current: current.avgPunctuationPeriod,
      baseline: baseline?.punctuation.periodRate ?? null,
      diff: diff(current.avgPunctuationPeriod, baseline?.punctuation.periodRate ?? null),
    },
  };
}

export async function GET(): Promise<NextResponse<StylometricAnalyticsResponse>> {
  try {
    const db = getDb();
    const posts = getRecentPostsWithSignatures(30);
    const totalApprovedStmt = db.prepare(
      `SELECT COUNT(*) as count FROM posts WHERE status = 'approved'`
    );
    const totalApproved = (totalApprovedStmt.get() as { count: number }).count;

    const trends = calculateTrends(posts);
    const current = calculateCurrentMetrics(posts);
    const baseline = loadBaselineSignature();
    const baselineComparison = calculateBaselineComparison(current, baseline);

    let voiceHealth: VoiceHealthStatus;

    // No data case: return "no_data" status with null values
    if (posts.length === 0 || current.sampleCount === 0) {
      voiceHealth = {
        status: 'no_data',
        score: null,
        driftPercentage: null,
        threshold: 0.15,
        issues: ['No posts with stylometric signatures available for analysis'],
      };
    } else {
      try {
        const driftResult = await checkStylometricDrift();

        // If drift analysis couldn't run due to insufficient data
        if (driftResult.recentPostsCount < 5) {
          voiceHealth = {
            status: 'no_data',
            score: null,
            driftPercentage: null,
            threshold: driftResult.threshold,
            issues: driftResult.feedback,
          };
        } else {
          const score = Math.round((1 - driftResult.driftPercentage) * 100);

          voiceHealth = {
            status: driftResult.alertLevel === 'none' ? 'healthy' : driftResult.alertLevel,
            score,
            driftPercentage: driftResult.driftPercentage,
            threshold: driftResult.threshold,
            issues: driftResult.feedback,
          };
        }
      } catch {
        voiceHealth = {
          status: 'unknown',
          score: null,
          driftPercentage: null,
          threshold: 0.15,
          issues: ['Unable to calculate drift'],
        };
      }
    }

    logger.debug('Stylometric analytics generated', {
      postsWithSignatures: posts.length,
      totalApproved,
      voiceHealthStatus: voiceHealth.status,
    });

    return NextResponse.json({
      trends,
      current,
      baseline: baselineComparison,
      voiceHealth,
      postsWithSignatures: posts.length,
      totalApprovedPosts: totalApproved,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to generate stylometric analytics', { error: message });

    return NextResponse.json(
      {
        trends: {
          sentenceLength: [],
          vocabularyRichness: [],
          punctuation: { period: [], comma: [], exclamation: [], question: [] },
        },
        current: {
          avgSentenceLength: null,
          avgVocabularyRichness: null,
          avgPunctuationPeriod: null,
          avgPunctuationComma: null,
          avgPunctuationExclamation: null,
          avgPunctuationQuestion: null,
          sampleCount: 0,
        },
        baseline: {
          sentenceLength: { current: null, baseline: null, diff: null },
          vocabularyRichness: { current: null, baseline: null, diff: null },
          punctuationPeriod: { current: null, baseline: null, diff: null },
        },
        voiceHealth: {
          status: 'unknown',
          score: null,
          driftPercentage: null,
          threshold: 0.15,
          issues: [message],
        },
        postsWithSignatures: 0,
        totalApprovedPosts: 0,
      },
      { status: 500 }
    );
  }
}
