#!/usr/bin/env tsx
/**
 * Pattern Consolidation Script
 *
 * Maintenance script to optimize the patterns table:
 * 1. Merge patterns with >85% Jaccard similarity
 * 2. Archive patterns with decay_score < 0.1
 *
 * Run manually: npx tsx scripts/consolidate-patterns.ts
 * Run as cron:  0 3 * * * cd /path/to/project && npx tsx scripts/consolidate-patterns.ts
 */

import { getDb, closeDb } from '../src/db/connection';
import { listPatterns, updatePattern, deletePattern } from '../src/db/models/patterns';
import type { Pattern, PatternType } from '../src/types';
import { createLogger } from '../src/lib/logger';

const logger = createLogger('consolidate-patterns');

// Consolidation thresholds
const SIMILARITY_MERGE_THRESHOLD = 0.85;
const DECAY_ARCHIVE_THRESHOLD = 0.1;

// Stop words for Jaccard similarity (same as patterns.ts)
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

interface ConsolidationResult {
  merged: number;
  archived: number;
  mergeGroups: Array<{
    type: PatternType;
    keptId: number;
    mergedIds: number[];
    similarity: number;
  }>;
  archivedPatterns: Array<{
    id: number;
    description: string;
    decayScore: number;
  }>;
}

function extractKeywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
  );
}

function calculateJaccardSimilarity(text1: string, text2: string): number {
  const words1 = extractKeywords(text1);
  const words2 = extractKeywords(text2);

  if (words1.size === 0 && words2.size === 0) return 1;
  if (words1.size === 0 || words2.size === 0) return 0;

  const intersection = [...words1].filter((w) => words2.has(w));
  const union = new Set([...words1, ...words2]);

  return intersection.length / union.size;
}

/**
 * Find groups of patterns that are >85% similar and should be merged.
 */
function findMergeGroups(patterns: Pattern[]): Map<number, Set<number>> {
  const groups = new Map<number, Set<number>>();
  const processed = new Set<number>();

  for (let i = 0; i < patterns.length; i++) {
    const p1 = patterns[i];
    if (processed.has(p1.id)) continue;

    const group = new Set<number>([p1.id]);

    for (let j = i + 1; j < patterns.length; j++) {
      const p2 = patterns[j];
      if (processed.has(p2.id)) continue;

      const similarity = calculateJaccardSimilarity(p1.description, p2.description);
      if (similarity >= SIMILARITY_MERGE_THRESHOLD) {
        group.add(p2.id);
        processed.add(p2.id);
      }
    }

    if (group.size > 1) {
      // Store group keyed by the pattern with highest evidence count
      const groupPatterns = [...group]
        .map((id) => patterns.find((p) => p.id === id)!)
        .sort((a, b) => b.evidenceCount - a.evidenceCount);
      const leaderId = groupPatterns[0].id;
      groups.set(leaderId, group);
    }

    processed.add(p1.id);
  }

  return groups;
}

/**
 * Merge a group of similar patterns into one.
 * Keeps the pattern with highest evidence, combines evidence counts.
 */
function mergePatternGroup(
  patterns: Pattern[],
  groupIds: Set<number>
): { keptId: number; mergedIds: number[]; similarity: number } | null {
  const groupPatterns = [...groupIds]
    .map((id) => patterns.find((p) => p.id === id))
    .filter((p): p is Pattern => p !== null)
    .sort((a, b) => {
      // Primary: decay score (keep most relevant)
      const decayDiff = b.decayScore - a.decayScore;
      if (Math.abs(decayDiff) > 0.01) return decayDiff;
      // Secondary: evidence count (keep most validated)
      return b.evidenceCount - a.evidenceCount;
    });

  if (groupPatterns.length < 2) return null;

  const leader = groupPatterns[0];
  const toMerge = groupPatterns.slice(1);

  // Calculate combined evidence
  const totalEvidence = groupPatterns.reduce((sum, p) => sum + p.evidenceCount, 0);
  const totalEditEvidence = groupPatterns.reduce((sum, p) => sum + p.editEvidenceCount, 0);
  const totalRejectionEvidence = groupPatterns.reduce(
    (sum, p) => sum + p.rejectionEvidenceCount,
    0
  );
  const totalAccessCount = groupPatterns.reduce((sum, p) => sum + p.accessCount, 0);

  // Update leader with combined evidence
  updatePattern(leader.id, {
    evidenceCount: totalEvidence,
    editEvidenceCount: totalEditEvidence,
    rejectionEvidenceCount: totalRejectionEvidence,
    accessCount: totalAccessCount,
  });

  // Delete merged patterns
  const mergedIds: number[] = [];
  for (const pattern of toMerge) {
    deletePattern(pattern.id);
    mergedIds.push(pattern.id);
  }

  // Calculate average similarity within group for reporting
  let totalSim = 0;
  let simCount = 0;
  for (let i = 0; i < groupPatterns.length - 1; i++) {
    for (let j = i + 1; j < groupPatterns.length; j++) {
      totalSim += calculateJaccardSimilarity(
        groupPatterns[i].description,
        groupPatterns[j].description
      );
      simCount++;
    }
  }

  return {
    keptId: leader.id,
    mergedIds,
    similarity: simCount > 0 ? totalSim / simCount : 1,
  };
}

/**
 * Archive patterns with decay_score below threshold.
 */
function archiveLowDecayPatterns(patterns: Pattern[]): Array<{
  id: number;
  description: string;
  decayScore: number;
}> {
  const archived: Array<{ id: number; description: string; decayScore: number }> = [];

  for (const pattern of patterns) {
    // Skip already archived/superseded patterns
    if (pattern.status !== 'active') continue;

    if (pattern.decayScore < DECAY_ARCHIVE_THRESHOLD) {
      updatePattern(pattern.id, { status: 'archived' });
      archived.push({
        id: pattern.id,
        description: pattern.description.slice(0, 50),
        decayScore: pattern.decayScore,
      });
    }
  }

  return archived;
}

/**
 * Main consolidation function.
 */
export async function consolidatePatterns(options: {
  dryRun?: boolean;
  verbose?: boolean;
}): Promise<ConsolidationResult> {
  const { dryRun = false, verbose = false } = options;

  const result: ConsolidationResult = {
    merged: 0,
    archived: 0,
    mergeGroups: [],
    archivedPatterns: [],
  };

  // Get all active patterns grouped by type
  const patternTypes: PatternType[] = ['voice', 'hook', 'topic', 'rejection', 'edit'];

  for (const patternType of patternTypes) {
    const patterns = listPatterns({
      patternType,
      status: 'active',
      limit: 1000,
    });

    if (patterns.length < 2) continue;

    if (verbose) {
      logger.info(`Processing ${patterns.length} ${patternType} patterns`);
    }

    // Find and process merge groups
    const mergeGroups = findMergeGroups(patterns);

    for (const [leaderId, groupIds] of mergeGroups) {
      if (dryRun) {
        const groupPatterns = [...groupIds]
          .map((id) => patterns.find((p) => p.id === id))
          .filter((p): p is Pattern => p !== null);

        logger.info(`[DRY RUN] Would merge group:`, {
          type: patternType,
          leaderId,
          memberIds: [...groupIds],
          descriptions: groupPatterns.map((p) => p.description.slice(0, 40)),
        });

        result.mergeGroups.push({
          type: patternType,
          keptId: leaderId,
          mergedIds: [...groupIds].filter((id) => id !== leaderId),
          similarity: 0.85,
        });
        result.merged += groupIds.size - 1;
      } else {
        const mergeResult = mergePatternGroup(patterns, groupIds);
        if (mergeResult) {
          result.mergeGroups.push({
            type: patternType,
            ...mergeResult,
          });
          result.merged += mergeResult.mergedIds.length;

          if (verbose) {
            logger.info(`Merged patterns:`, {
              type: patternType,
              kept: mergeResult.keptId,
              merged: mergeResult.mergedIds,
              avgSimilarity: mergeResult.similarity.toFixed(2),
            });
          }
        }
      }
    }

    // Archive low decay patterns
    if (dryRun) {
      for (const pattern of patterns) {
        if (pattern.status === 'active' && pattern.decayScore < DECAY_ARCHIVE_THRESHOLD) {
          logger.info(`[DRY RUN] Would archive:`, {
            id: pattern.id,
            description: pattern.description.slice(0, 40),
            decayScore: pattern.decayScore.toFixed(3),
          });
          result.archivedPatterns.push({
            id: pattern.id,
            description: pattern.description.slice(0, 50),
            decayScore: pattern.decayScore,
          });
          result.archived++;
        }
      }
    } else {
      const archived = archiveLowDecayPatterns(patterns);
      result.archivedPatterns.push(...archived);
      result.archived += archived.length;
    }
  }

  return result;
}

/**
 * Print consolidation summary.
 */
function printSummary(result: ConsolidationResult, dryRun: boolean): void {
  const prefix = dryRun ? '[DRY RUN] ' : '';
  console.log('\n' + '='.repeat(50));
  console.log(`${prefix}Pattern Consolidation Summary`);
  console.log('='.repeat(50));
  console.log(`Patterns merged: ${result.merged}`);
  console.log(`Patterns archived: ${result.archived}`);

  if (result.mergeGroups.length > 0) {
    console.log('\nMerge groups:');
    for (const group of result.mergeGroups) {
      console.log(
        `  - ${group.type}: kept #${group.keptId}, merged ${group.mergedIds.join(', ')}`
      );
    }
  }

  if (result.archivedPatterns.length > 0) {
    console.log('\nArchived patterns:');
    for (const pattern of result.archivedPatterns.slice(0, 10)) {
      console.log(`  - #${pattern.id}: "${pattern.description}..." (decay: ${pattern.decayScore.toFixed(3)})`);
    }
    if (result.archivedPatterns.length > 10) {
      console.log(`  ... and ${result.archivedPatterns.length - 10} more`);
    }
  }

  console.log('='.repeat(50) + '\n');
}

/**
 * CLI entry point.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run') || args.includes('-n');
  const verbose = args.includes('--verbose') || args.includes('-v');
  const help = args.includes('--help') || args.includes('-h');

  if (help) {
    console.log(`
Pattern Consolidation Script

Usage: npx tsx scripts/consolidate-patterns.ts [options]

Options:
  --dry-run, -n    Show what would be done without making changes
  --verbose, -v    Show detailed progress
  --help, -h       Show this help message

Thresholds:
  - Merge: patterns with >${(SIMILARITY_MERGE_THRESHOLD * 100).toFixed(0)}% Jaccard similarity
  - Archive: patterns with decay_score <${DECAY_ARCHIVE_THRESHOLD}

Cron example (run daily at 3am):
  0 3 * * * cd /path/to/project && npx tsx scripts/consolidate-patterns.ts
`);
    process.exit(0);
  }

  try {
    console.log('Initializing database...');
    getDb(); // Initialize DB connection

    console.log(`Running consolidation${dryRun ? ' (dry run)' : ''}...`);
    const result = await consolidatePatterns({ dryRun, verbose });

    printSummary(result, dryRun);

    if (result.merged === 0 && result.archived === 0) {
      console.log('No patterns needed consolidation.');
    }

    process.exit(0);
  } catch (error) {
    logger.error('Consolidation failed:', error);
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  } finally {
    closeDb();
  }
}

// Run if executed directly
main();
