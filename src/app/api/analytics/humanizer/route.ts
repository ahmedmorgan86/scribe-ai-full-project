import { NextResponse } from 'next/server';
import { getDb } from '@/db/connection';
import {
  checkHumanizerPatterns,
  getPatternName,
  type HumanizerPatternType,
} from '@/lib/slop/humanizer-patterns';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api:analytics-humanizer');

interface PatternStat {
  patternType: HumanizerPatternType;
  patternName: string;
  count: number;
  severity: 'low' | 'medium' | 'high';
  postsAffected: number;
}

export interface HumanizerAnalyticsResponse {
  topPatterns: PatternStat[];
  totalPatternsDetected: number;
  postsAnalyzed: number;
  postsWithPatterns: number;
  avgPatternsPerPost: number;
}

interface PostRow {
  id: number;
  content: string;
}

function getRecentPosts(limit: number): PostRow[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT id, content FROM posts
    WHERE status IN ('approved', 'pending', 'draft')
    ORDER BY created_at DESC
    LIMIT ?
  `);
  return stmt.all(limit) as PostRow[];
}

export function GET(): NextResponse<HumanizerAnalyticsResponse> {
  try {
    const posts = getRecentPosts(100);
    const patternCounts = new Map<
      HumanizerPatternType,
      { count: number; severity: 'low' | 'medium' | 'high'; postsAffected: Set<number> }
    >();
    let totalPatternsDetected = 0;
    let postsWithPatterns = 0;

    for (const post of posts) {
      const result = checkHumanizerPatterns(post.content);
      if (result.hasIssues) {
        postsWithPatterns++;
      }

      for (const pattern of result.patterns) {
        totalPatternsDetected += pattern.count;
        const existing = patternCounts.get(pattern.patternType);
        if (existing) {
          existing.count += pattern.count;
          existing.postsAffected.add(post.id);
        } else {
          patternCounts.set(pattern.patternType, {
            count: pattern.count,
            severity: pattern.severity,
            postsAffected: new Set([post.id]),
          });
        }
      }
    }

    const topPatterns: PatternStat[] = Array.from(patternCounts.entries())
      .map(([patternType, data]) => ({
        patternType,
        patternName: getPatternName(patternType),
        count: data.count,
        severity: data.severity,
        postsAffected: data.postsAffected.size,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const avgPatternsPerPost =
      posts.length > 0 ? Math.round((totalPatternsDetected / posts.length) * 100) / 100 : 0;

    logger.debug('Humanizer analytics generated', {
      postsAnalyzed: posts.length,
      postsWithPatterns,
      totalPatternsDetected,
    });

    return NextResponse.json({
      topPatterns,
      totalPatternsDetected,
      postsAnalyzed: posts.length,
      postsWithPatterns,
      avgPatternsPerPost,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to generate humanizer analytics', { error: message });

    return NextResponse.json(
      {
        topPatterns: [],
        totalPatternsDetected: 0,
        postsAnalyzed: 0,
        postsWithPatterns: 0,
        avgPatternsPerPost: 0,
      },
      { status: 500 }
    );
  }
}
