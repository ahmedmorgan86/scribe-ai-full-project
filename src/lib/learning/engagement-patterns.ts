import { getDb } from '@/db/connection';

const HIGH_ENGAGEMENT_THRESHOLD = 50;
const LOW_ENGAGEMENT_THRESHOLD = 5;
const DECAY_BOOST = 0.1;
const DECAY_PENALTY = 0.05;

/**
 * Updates pattern decay scores based on engagement metrics.
 * High engagement boosts the decay score, low engagement reduces it.
 *
 * @param patternIds - Array of pattern IDs used in the post
 * @param totalEngagement - Combined engagement score (likes + retweets*3)
 * @returns Number of patterns updated
 */
export function updatePatternDecayFromEngagement(
  patternIds: number[],
  totalEngagement: number
): number {
  if (patternIds.length === 0) return 0;

  const db = getDb();
  let updated = 0;

  // Determine if this is high or low engagement
  const isHighEngagement = totalEngagement >= HIGH_ENGAGEMENT_THRESHOLD;
  const isLowEngagement = totalEngagement < LOW_ENGAGEMENT_THRESHOLD;

  if (!isHighEngagement && !isLowEngagement) {
    // Neutral engagement, no update needed
    return 0;
  }

  const decayAdjustment = isHighEngagement ? DECAY_BOOST : -DECAY_PENALTY;

  for (const patternId of patternIds) {
    // Get current decay score
    const stmt = db.prepare(`SELECT decay_score FROM patterns WHERE id = ?`);
    const row = stmt.get(patternId) as { decay_score: number } | undefined;

    if (!row) continue;

    // Calculate new decay score (clamped between 0.01 and 1.0)
    const newDecay = Math.max(0.01, Math.min(1.0, row.decay_score + decayAdjustment));

    // Update the pattern
    const updateStmt = db.prepare(`
      UPDATE patterns
      SET decay_score = ?, updated_at = datetime('now')
      WHERE id = ?
    `);
    const result = updateStmt.run(newDecay, patternId);

    if (result.changes > 0) {
      updated++;
    }
  }

  return updated;
}

/**
 * Gets the engagement multiplier for a pattern based on recent post performance.
 */
export function getEngagementMultiplier(patternId: number): number {
  const db = getDb();

  // Find posts that used this pattern and have engagement data
  const stmt = db.prepare(`
    SELECT likes, retweets
    FROM posts
    WHERE reasoning LIKE ?
    AND engagement_updated_at IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 10
  `);

  const pattern = `%"patternsUsed":%${patternId}%`;
  const rows = stmt.all(pattern) as Array<{ likes: number; retweets: number }>;

  if (rows.length === 0) {
    return 1.0; // No data, neutral multiplier
  }

  // Calculate average engagement
  const totalEngagement = rows.reduce((sum, r) => sum + r.likes + r.retweets * 3, 0);
  const avgEngagement = totalEngagement / rows.length;

  // Convert to multiplier (0.5 to 1.5 range)
  if (avgEngagement >= HIGH_ENGAGEMENT_THRESHOLD) {
    return 1.0 + Math.min(0.5, (avgEngagement - HIGH_ENGAGEMENT_THRESHOLD) / 100);
  } else if (avgEngagement < LOW_ENGAGEMENT_THRESHOLD) {
    return Math.max(0.5, 1.0 - (LOW_ENGAGEMENT_THRESHOLD - avgEngagement) / 10);
  }

  return 1.0;
}

/**
 * Gets patterns ranked by their engagement performance.
 */
export function getPatternsByEngagement(): Array<{
  patternId: number;
  patternType: string;
  description: string;
  avgEngagement: number;
  postCount: number;
}> {
  const db = getDb();

  // Get all patterns with their engagement stats
  const stmt = db.prepare(`
    SELECT
      p.id as patternId,
      p.pattern_type as patternType,
      p.description,
      COUNT(DISTINCT posts.id) as postCount,
      AVG(COALESCE(posts.likes, 0) + COALESCE(posts.retweets, 0) * 3) as avgEngagement
    FROM patterns p
    LEFT JOIN posts ON posts.reasoning LIKE '%' || p.id || '%'
      AND posts.engagement_updated_at IS NOT NULL
    GROUP BY p.id
    HAVING postCount > 0
    ORDER BY avgEngagement DESC
    LIMIT 50
  `);

  return stmt.all() as Array<{
    patternId: number;
    patternType: string;
    description: string;
    avgEngagement: number;
    postCount: number;
  }>;
}
