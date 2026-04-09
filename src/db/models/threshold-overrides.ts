import { getDb } from '@/db/connection';

export type ThresholdKey =
  | 'voice.similarity'
  | 'voice.minConfidence'
  | 'voice.minDimensionScore'
  | 'voice.contrastThreshold'
  | 'slop.maxScore'
  | 'slop.warningScore'
  | 'slop.semanticThreshold'
  | 'stylometry.similarity'
  | 'stylometry.minDimensions'
  | 'stylometry.maxDrift'
  | 'stylometryWeights.sentenceLength'
  | 'stylometryWeights.punctuation'
  | 'stylometryWeights.vocabulary'
  | 'stylometryWeights.functionWords'
  | 'stylometryWeights.syntactic'
  | 'duplicate.postSimilarity'
  | 'duplicate.sourceSimilarity'
  | 'learning.stuckBaseThreshold'
  | 'learning.patternSimilarity';

const VALID_THRESHOLD_KEYS: ThresholdKey[] = [
  'voice.similarity',
  'voice.minConfidence',
  'voice.minDimensionScore',
  'voice.contrastThreshold',
  'slop.maxScore',
  'slop.warningScore',
  'slop.semanticThreshold',
  'stylometry.similarity',
  'stylometry.minDimensions',
  'stylometry.maxDrift',
  'stylometryWeights.sentenceLength',
  'stylometryWeights.punctuation',
  'stylometryWeights.vocabulary',
  'stylometryWeights.functionWords',
  'stylometryWeights.syntactic',
  'duplicate.postSimilarity',
  'duplicate.sourceSimilarity',
  'learning.stuckBaseThreshold',
  'learning.patternSimilarity',
];

export interface ThresholdOverride {
  key: string;
  value: number;
  updatedAt: string;
}

export function isValidThresholdKey(key: string): key is ThresholdKey {
  return VALID_THRESHOLD_KEYS.includes(key as ThresholdKey);
}

export function getValidThresholdKeys(): ThresholdKey[] {
  return [...VALID_THRESHOLD_KEYS];
}

export function getAllThresholdOverrides(): ThresholdOverride[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT key, value, updated_at as updatedAt
    FROM threshold_overrides
    ORDER BY key
  `);
  return stmt.all() as ThresholdOverride[];
}

export function getThresholdOverride(key: ThresholdKey): ThresholdOverride | null {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT key, value, updated_at as updatedAt
    FROM threshold_overrides
    WHERE key = ?
  `);
  const result = stmt.get(key) as ThresholdOverride | undefined;
  return result ?? null;
}

export function setThresholdOverrides(
  overrides: Array<{ key: ThresholdKey; value: number }>
): number {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO threshold_overrides (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = datetime('now')
  `);

  let count = 0;
  const transaction = db.transaction(() => {
    for (const override of overrides) {
      stmt.run(override.key, override.value);
      count++;
    }
  });
  transaction();

  return count;
}

export function deleteThresholdOverride(key: ThresholdKey): boolean {
  const db = getDb();
  const stmt = db.prepare(`DELETE FROM threshold_overrides WHERE key = ?`);
  const result = stmt.run(key);
  return result.changes > 0;
}

export function deleteAllThresholdOverrides(): number {
  const db = getDb();
  const stmt = db.prepare(`DELETE FROM threshold_overrides`);
  const result = stmt.run();
  return result.changes;
}
