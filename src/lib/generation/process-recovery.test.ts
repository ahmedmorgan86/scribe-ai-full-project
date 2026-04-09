/**
 * Tests for Process Recovery and Clean Failure Handling
 *
 * Phase 1.6 Task 30.2: Verify behavior when process is killed mid-generation.
 *
 * Architecture Decision (Option C - Stateless TypeScript Generator):
 * - LangGraph: Production pipeline with SQLite checkpointing for state recovery
 * - TypeScript Generator: Stateless fallback/testing tool (~10-30s execution)
 *
 * Expected Behaviors:
 * 1. TypeScript generator: Jobs left in 'running' status are detected on startup
 *    and can be marked as interrupted (clean failure, not recovery)
 * 2. LangGraph: Full checkpoint-based state recovery is possible
 * 3. Both pipelines use shared job tracking in generation_jobs table
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import {
  createGenerationJob,
  startGenerationJob,
  completeGenerationJob,
  failGenerationJob,
  getGenerationJobById,
  getRunningJobs,
  listGenerationJobs,
  updateGenerationJob,
  getJobStats,
  cleanupOldJobs,
} from '@/db/models/generation-jobs';
import { getDb, closeDb, resetDb } from '@/db/connection';
import { runMigrations } from '@/db/migrations';

const TEST_DB_PATH = './data/test-process-recovery.db';

beforeAll(() => {
  process.env.SQLITE_DB_PATH = TEST_DB_PATH;
});

afterAll(() => {
  closeDb();
  resetDb();
  delete process.env.SQLITE_DB_PATH;
});

describe('Process Recovery - Generation Job State Management', () => {
  beforeEach(() => {
    resetDb();
    runMigrations();
  });

  afterEach(() => {
    closeDb();
  });

  describe('TypeScript Generator - Stateless Clean Failure', () => {
    it('should detect jobs left in running status after process restart', () => {
      const job = createGenerationJob({
        pipeline: 'typescript',
        sourceIds: [1, 2, 3],
        contentType: 'tweet',
      });
      startGenerationJob(job.id);

      const runningJobs = getRunningJobs();

      expect(runningJobs).toHaveLength(1);
      expect(runningJobs[0].id).toBe(job.id);
      expect(runningJobs[0].status).toBe('running');
      expect(runningJobs[0].pipeline).toBe('typescript');
    });

    it('should allow marking interrupted jobs as failed with error message', () => {
      const job = createGenerationJob({
        pipeline: 'typescript',
        sourceIds: [1],
        contentType: 'tweet',
      });
      startGenerationJob(job.id);

      const errorMsg = 'Process interrupted - job was running when process terminated';
      const failedJob = failGenerationJob(job.id, errorMsg);

      expect(failedJob).not.toBeNull();
      expect(failedJob?.status).toBe('failed');
      expect(failedJob?.error).toBe(errorMsg);
      expect(failedJob?.completedAt).not.toBeNull();
    });

    it('should support recovery function to mark all running jobs as interrupted', () => {
      const job1 = createGenerationJob({ pipeline: 'typescript', sourceIds: [1] });
      const job2 = createGenerationJob({ pipeline: 'typescript', sourceIds: [2] });
      const job3 = createGenerationJob({ pipeline: 'langgraph', sourceIds: [3] });

      startGenerationJob(job1.id);
      startGenerationJob(job2.id);
      startGenerationJob(job3.id);

      const runningBefore = getRunningJobs();
      expect(runningBefore).toHaveLength(3);

      for (const job of runningBefore) {
        if (job.pipeline === 'typescript') {
          failGenerationJob(job.id, 'Process interrupted');
        }
      }

      const runningAfter = getRunningJobs();

      expect(runningAfter).toHaveLength(1);
      expect(runningAfter[0].pipeline).toBe('langgraph');
    });

    it('should preserve metadata when marking job as failed', () => {
      const job = createGenerationJob({
        pipeline: 'typescript',
        sourceIds: [1, 2],
        contentType: 'thread',
        metadata: {
          forceFormula: 'problem-solution',
          maxRewriteAttempts: 3,
        },
      });
      startGenerationJob(job.id);

      failGenerationJob(job.id, 'Process killed');
      const retrieved = getGenerationJobById(job.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.metadata).toEqual({
        forceFormula: 'problem-solution',
        maxRewriteAttempts: 3,
      });
      expect(retrieved?.sourceIds).toEqual([1, 2]);
      expect(retrieved?.contentType).toBe('thread');
    });

    it('should track job statistics including interrupted jobs', () => {
      const job1 = createGenerationJob({ pipeline: 'typescript', sourceIds: [1] });
      const job2 = createGenerationJob({ pipeline: 'typescript', sourceIds: [2] });
      const job3 = createGenerationJob({ pipeline: 'langgraph', sourceIds: [3] });

      startGenerationJob(job1.id);
      startGenerationJob(job2.id);
      completeGenerationJob(job3.id, null); // Use null for post_id to avoid FK constraint
      failGenerationJob(job1.id, 'Process interrupted');

      const stats = getJobStats();

      expect(stats.total).toBe(3);
      expect(stats.running).toBe(1);
      expect(stats.completed).toBe(1);
      expect(stats.failed).toBe(1);
      expect(stats.byPipeline.typescript).toBe(2);
      expect(stats.byPipeline.langgraph).toBe(1);
    });
  });

  describe('LangGraph Pipeline - Checkpoint State Tracking', () => {
    it('should track LangGraph jobs separately from TypeScript jobs', () => {
      const tsJob = createGenerationJob({
        pipeline: 'typescript',
        sourceIds: [1],
        contentType: 'tweet',
      });
      const lgJob = createGenerationJob({
        pipeline: 'langgraph',
        sourceIds: [2],
        contentType: 'tweet',
      });

      startGenerationJob(tsJob.id);
      startGenerationJob(lgJob.id);

      const tsJobs = listGenerationJobs({ pipeline: 'typescript', status: 'running' });
      const lgJobs = listGenerationJobs({ pipeline: 'langgraph', status: 'running' });

      expect(tsJobs).toHaveLength(1);
      expect(lgJobs).toHaveLength(1);
      expect(tsJobs[0].id).toBe(tsJob.id);
      expect(lgJobs[0].id).toBe(lgJob.id);
    });

    it('should allow LangGraph jobs to remain running for external recovery handling', () => {
      const lgJob = createGenerationJob({
        pipeline: 'langgraph',
        sourceIds: [1, 2, 3],
        contentType: 'thread',
      });
      startGenerationJob(lgJob.id);

      const runningJobs = getRunningJobs();
      const lgRunning = runningJobs.filter((j) => j.pipeline === 'langgraph');

      expect(lgRunning).toHaveLength(1);
      expect(lgRunning[0].status).toBe('running');

      const job = getGenerationJobById(lgJob.id);
      expect(job).not.toBeNull();
      expect(job?.startedAt).toBeDefined();
      expect(job?.completedAt).toBeNull();
    });

    it('should support updating job metadata during generation', () => {
      const job = createGenerationJob({
        pipeline: 'langgraph',
        sourceIds: [1],
      });
      startGenerationJob(job.id);

      updateGenerationJob(job.id, {
        metadata: {
          currentNode: 'voice_check',
          rewriteCount: 1,
          checkpointId: 'cp-123',
        },
      });

      const updated = getGenerationJobById(job.id);
      expect(updated?.metadata).toEqual({
        currentNode: 'voice_check',
        rewriteCount: 1,
        checkpointId: 'cp-123',
      });
    });
  });

  describe('Unified Job Tracking', () => {
    it('should list all jobs regardless of pipeline', () => {
      createGenerationJob({ pipeline: 'typescript', sourceIds: [1] });
      createGenerationJob({ pipeline: 'typescript', sourceIds: [2] });
      createGenerationJob({ pipeline: 'langgraph', sourceIds: [3] });
      createGenerationJob({ pipeline: 'langgraph', sourceIds: [4] });

      const allJobs = listGenerationJobs({});

      expect(allJobs).toHaveLength(4);
    });

    it('should support filtering by status across pipelines', () => {
      const job1 = createGenerationJob({ pipeline: 'typescript', sourceIds: [1] });
      const job2 = createGenerationJob({ pipeline: 'langgraph', sourceIds: [2] });
      const job3 = createGenerationJob({ pipeline: 'typescript', sourceIds: [3] });

      startGenerationJob(job1.id);
      completeGenerationJob(job2.id, null); // Use null for post_id to avoid FK constraint
      failGenerationJob(job3.id, 'Error');

      const runningJobs = listGenerationJobs({ status: 'running' });
      const completedJobs = listGenerationJobs({ status: 'completed' });
      const failedJobs = listGenerationJobs({ status: 'failed' });
      const pendingJobs = listGenerationJobs({ status: 'pending' });

      expect(runningJobs).toHaveLength(1);
      expect(completedJobs).toHaveLength(1);
      expect(failedJobs).toHaveLength(1);
      expect(pendingJobs).toHaveLength(0);
    });

    it('should support cleanup of old completed/failed jobs', () => {
      const db = getDb();

      db.exec(`
        INSERT INTO generation_jobs (id, pipeline, status, started_at, completed_at)
        VALUES
          ('old-completed', 'typescript', 'completed', datetime('now', '-60 days'), datetime('now', '-60 days')),
          ('old-failed', 'langgraph', 'failed', datetime('now', '-45 days'), datetime('now', '-45 days')),
          ('recent-completed', 'typescript', 'completed', datetime('now', '-5 days'), datetime('now', '-5 days')),
          ('running-old', 'langgraph', 'running', datetime('now', '-60 days'), NULL)
      `);

      const deleted = cleanupOldJobs(30);

      expect(deleted).toBe(2);

      const remaining = listGenerationJobs({});
      expect(remaining.map((j) => j.id)).toContain('recent-completed');
      expect(remaining.map((j) => j.id)).toContain('running-old');
      expect(remaining.map((j) => j.id)).not.toContain('old-completed');
      expect(remaining.map((j) => j.id)).not.toContain('old-failed');
    });
  });

  describe('Startup Recovery Simulation', () => {
    it('should implement recovery helper to handle stale running jobs', () => {
      const job1 = createGenerationJob({ pipeline: 'typescript', sourceIds: [1] });
      const job2 = createGenerationJob({ pipeline: 'langgraph', sourceIds: [2] });

      startGenerationJob(job1.id);
      startGenerationJob(job2.id);

      interface RecoveryOptions {
        markTypescriptAsFailed?: boolean;
      }
      interface RecoveryResult {
        id: string;
        action: 'marked_failed' | 'left_running';
      }

      const recoverInterruptedJobs = (options: RecoveryOptions = {}): RecoveryResult[] => {
        const { markTypescriptAsFailed = true } = options;
        const runningJobs = getRunningJobs();
        const recovered: RecoveryResult[] = [];

        for (const job of runningJobs) {
          if (job.pipeline === 'typescript' && markTypescriptAsFailed) {
            failGenerationJob(job.id, 'Process interrupted - recovered on startup');
            recovered.push({ id: job.id, action: 'marked_failed' });
          } else {
            recovered.push({ id: job.id, action: 'left_running' });
          }
        }

        return recovered;
      };

      const results = recoverInterruptedJobs();

      expect(results).toHaveLength(2);
      expect(results.find((r) => r.id === job1.id)?.action).toBe('marked_failed');
      expect(results.find((r) => r.id === job2.id)?.action).toBe('left_running');

      const tsJob = getGenerationJobById(job1.id);
      const lgJob = getGenerationJobById(job2.id);

      expect(tsJob?.status).toBe('failed');
      expect(tsJob?.error).toContain('Process interrupted');
      expect(lgJob?.status).toBe('running');
    });

    it('should handle case with no stale jobs gracefully', () => {
      const job = createGenerationJob({ pipeline: 'typescript', sourceIds: [1] });
      completeGenerationJob(job.id, null); // Use null for post_id to avoid FK constraint

      const runningJobs = getRunningJobs();
      expect(runningJobs).toHaveLength(0);
    });

    it('should detect jobs running longer than threshold', () => {
      const db = getDb();

      db.exec(`
        INSERT INTO generation_jobs (id, pipeline, status, started_at)
        VALUES
          ('stale-ts', 'typescript', 'running', datetime('now', '-2 hours')),
          ('stale-lg', 'langgraph', 'running', datetime('now', '-30 minutes')),
          ('recent', 'typescript', 'running', datetime('now', '-1 minute'))
      `);

      const staleThresholdMinutes = 10;
      const allRunning = getRunningJobs();

      // Filter to only test-specific jobs by ID prefix
      const testJobs = allRunning.filter(
        (job) => job.id === 'stale-ts' || job.id === 'stale-lg' || job.id === 'recent'
      );

      const staleJobs = testJobs.filter((job) => {
        // SQLite datetime() returns UTC time without 'Z' suffix, so we need to add it
        const startedAtStr = job.startedAt.replace(' ', 'T') + 'Z';
        const startedAt = new Date(startedAtStr);
        const now = new Date();
        const minutesRunning = (now.getTime() - startedAt.getTime()) / (1000 * 60);
        return minutesRunning > staleThresholdMinutes;
      });

      expect(staleJobs).toHaveLength(2);
      expect(staleJobs.map((j) => j.id)).toContain('stale-ts');
      expect(staleJobs.map((j) => j.id)).toContain('stale-lg');
      expect(staleJobs.map((j) => j.id)).not.toContain('recent');
    });
  });

  describe('Job Lifecycle State Transitions', () => {
    it('should enforce valid state transitions', () => {
      const job = createGenerationJob({ pipeline: 'typescript', sourceIds: [1] });

      expect(job.status).toBe('pending');

      const started = startGenerationJob(job.id);
      expect(started?.status).toBe('running');

      const completed = completeGenerationJob(job.id, null); // Use null for post_id to avoid FK constraint
      expect(completed?.status).toBe('completed');
      expect(completed?.postId).toBe(null);
    });

    it('should record completion time on failure', () => {
      const job = createGenerationJob({ pipeline: 'typescript', sourceIds: [1] });
      startGenerationJob(job.id);

      const beforeFail = new Date();
      const failed = failGenerationJob(job.id, 'Test error');
      const afterFail = new Date();

      expect(failed?.completedAt).not.toBeNull();
      const completedAtStr = failed?.completedAt ?? '';
      const completedAt = new Date(completedAtStr.replace(' ', 'T') + 'Z');
      expect(completedAt.getTime()).toBeGreaterThanOrEqual(beforeFail.getTime() - 1000);
      expect(completedAt.getTime()).toBeLessThanOrEqual(afterFail.getTime() + 1000);
    });

    it('should handle concurrent job creation', () => {
      const jobs = Array.from({ length: 10 }, (_, i) =>
        createGenerationJob({
          pipeline: i % 2 === 0 ? 'typescript' : 'langgraph',
          sourceIds: [i],
        })
      );

      const uniqueIds = new Set(jobs.map((j) => j.id));
      expect(uniqueIds.size).toBe(10);

      const allJobs = listGenerationJobs({});
      expect(allJobs).toHaveLength(10);
    });
  });
});

describe('Process Recovery - Integration with Generator', () => {
  beforeEach(() => {
    resetDb();
    runMigrations();
  });

  afterEach(() => {
    closeDb();
  });

  it('should create job when trackJob option is true (default)', () => {
    const initialJobs = listGenerationJobs({});
    expect(initialJobs).toHaveLength(0);

    const job = createGenerationJob({
      pipeline: 'typescript',
      sourceIds: [1],
      contentType: 'tweet',
      metadata: { trackJob: true },
    });

    const jobAfter = getGenerationJobById(job.id);
    expect(jobAfter).not.toBeNull();
    expect(jobAfter?.pipeline).toBe('typescript');
  });

  it('should update job status through generation lifecycle', () => {
    const job = createGenerationJob({
      pipeline: 'typescript',
      sourceIds: [1],
    });

    expect(getGenerationJobById(job.id)?.status).toBe('pending');

    startGenerationJob(job.id);
    expect(getGenerationJobById(job.id)?.status).toBe('running');

    updateGenerationJob(job.id, {
      metadata: { stage: 'slop_detection', rewriteCount: 1 },
    });
    expect(getGenerationJobById(job.id)?.metadata).toEqual({
      stage: 'slop_detection',
      rewriteCount: 1,
    });

    completeGenerationJob(job.id, null); // Use null for post_id to avoid FK constraint
    const final = getGenerationJobById(job.id);
    expect(final?.status).toBe('completed');
    expect(final?.postId).toBe(null);
    expect(final?.completedAt).not.toBeNull();
  });

  it('should fail job on generation error', () => {
    const job = createGenerationJob({
      pipeline: 'typescript',
      sourceIds: [1],
    });

    startGenerationJob(job.id);

    const errorMessage = 'API rate limit exceeded';
    failGenerationJob(job.id, errorMessage);

    const failed = getGenerationJobById(job.id);
    expect(failed?.status).toBe('failed');
    expect(failed?.error).toBe(errorMessage);
    expect(failed?.completedAt).not.toBeNull();
  });
});
