import {
  getSchedulerConfig,
  updateSchedulerConfig,
  calculateNextRunTime,
} from '@/db/models/scheduler-config';
import { createSchedulerRun, completeSchedulerRun } from '@/db/models/scheduler-runs';
import { selectSource } from './source-selector';
import { countQueue } from '@/db/models/queue';
import { createLogger } from '@/lib/logger';
import {
  isDiscordConfigured,
  sendNotification,
  isNotificationTypeEnabled,
} from '@/lib/notifications/discord';

const logger = createLogger('scheduler-worker');

export interface SchedulerRunResult {
  runId: number;
  status: 'completed' | 'failed' | 'skipped';
  postsGenerated: number;
  postsQueued: number;
  error?: string;
  sourceId?: number;
  durationMs?: number;
}

async function callGenerateAPI(sourceId: number): Promise<{
  success: boolean;
  postId?: number;
  error?: string;
}> {
  try {
    // Build the URL - in production this would be the full URL
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceId,
        addToQueue: true,
        queuePriority: 0,
        skipVoiceValidation: false,
        useLangGraph: true,
      }),
    });

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => ({ error: 'Unknown error' }))) as {
        error?: string;
      };
      return {
        success: false,
        error: errorBody.error ?? `HTTP ${response.status}`,
      };
    }

    const result = (await response.json()) as { post?: { id: number } };
    return {
      success: true,
      postId: result.post?.id,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function runScheduler(): Promise<SchedulerRunResult> {
  const config = getSchedulerConfig();

  // Check if scheduler is enabled
  if (!config.enabled) {
    logger.info('Scheduler is disabled, skipping run');
    return {
      runId: 0,
      status: 'skipped',
      postsGenerated: 0,
      postsQueued: 0,
      error: 'Scheduler is disabled',
    };
  }

  // Check time slots if configured
  if (config.timeSlots && config.timeSlots.length > 0) {
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTime = `${currentHour.toString().padStart(2, '0')}:${currentMinute.toString().padStart(2, '0')}`;

    // Allow a 5-minute window around each time slot
    const isWithinSlot = config.timeSlots.some((slot) => {
      const [slotHour, slotMinute] = slot.split(':').map(Number);
      const slotMinutes = slotHour * 60 + slotMinute;
      const currentMinutes = currentHour * 60 + currentMinute;
      const diff = Math.abs(slotMinutes - currentMinutes);
      return diff <= 5;
    });

    if (!isWithinSlot) {
      logger.debug('Not within configured time slot', { currentTime, timeSlots: config.timeSlots });
      return {
        runId: 0,
        status: 'skipped',
        postsGenerated: 0,
        postsQueued: 0,
        error: 'Not within configured time slot',
      };
    }
  }

  // Check queue size
  const currentQueueSize = countQueue();
  if (currentQueueSize >= config.maxQueueSize) {
    logger.info('Queue is full', { currentQueueSize, maxQueueSize: config.maxQueueSize });
    return {
      runId: 0,
      status: 'skipped',
      postsGenerated: 0,
      postsQueued: 0,
      error: `Queue is full (${currentQueueSize}/${config.maxQueueSize})`,
    };
  }

  // Select source
  const selection = selectSource(config);
  if (!selection) {
    logger.warn('No sources available for generation');
    return {
      runId: 0,
      status: 'skipped',
      postsGenerated: 0,
      postsQueued: 0,
      error: 'No sources available',
    };
  }

  const { source, selectionReason } = selection;
  logger.info('Selected source for generation', {
    sourceId: source.id,
    sourceType: source.sourceType,
    selectionReason,
  });

  // Create run record
  const run = createSchedulerRun({ sourceId: source.id });

  try {
    // Call generation API
    const result = await callGenerateAPI(source.id);

    if (!result.success) {
      completeSchedulerRun(run.id, 'failed', 0, 0, result.error);

      // Update config timestamps
      const now = new Date();
      updateSchedulerConfig({
        lastRunAt: now.toISOString(),
        nextRunAt: calculateNextRunTime(config).toISOString(),
      });

      return {
        runId: run.id,
        status: 'failed',
        postsGenerated: 0,
        postsQueued: 0,
        error: result.error,
        sourceId: source.id,
      };
    }

    // Success
    const completedRun = completeSchedulerRun(run.id, 'completed', 1, 1);

    // Update config timestamps
    const now = new Date();
    updateSchedulerConfig({
      lastRunAt: now.toISOString(),
      nextRunAt: calculateNextRunTime(config).toISOString(),
    });

    logger.info('Scheduler run completed successfully', {
      runId: run.id,
      postId: result.postId,
      sourceId: source.id,
      durationMs: completedRun?.durationMs,
    });

    // Send Discord notification if configured
    const newQueueSize = countQueue();
    if (isDiscordConfigured() && isNotificationTypeEnabled('content_ready')) {
      try {
        await sendNotification(
          'content_ready',
          'New Content Generated',
          `Scheduler generated new content from ${source.sourceType}. Queue size: ${newQueueSize}`,
          'low',
          [
            { name: 'Source', value: source.sourceId, inline: true },
            { name: 'Post ID', value: String(result.postId ?? 'N/A'), inline: true },
          ]
        );
      } catch (notifyError) {
        logger.warn('Failed to send Discord notification', { error: notifyError });
      }
    }

    return {
      runId: run.id,
      status: 'completed',
      postsGenerated: 1,
      postsQueued: 1,
      sourceId: source.id,
      durationMs: completedRun?.durationMs ?? undefined,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    completeSchedulerRun(run.id, 'failed', 0, 0, errorMessage);

    logger.error('Scheduler run failed', { runId: run.id, error: errorMessage });

    return {
      runId: run.id,
      status: 'failed',
      postsGenerated: 0,
      postsQueued: 0,
      error: errorMessage,
      sourceId: source.id,
    };
  }
}

export function shouldRunNow(): boolean {
  const config = getSchedulerConfig();

  if (!config.enabled) {
    return false;
  }

  // Check if next_run_at has passed
  if (config.nextRunAt) {
    const nextRun = new Date(config.nextRunAt);
    const now = new Date();
    return now >= nextRun;
  }

  // If no nextRunAt is set, check based on last run and interval
  if (config.lastRunAt) {
    const lastRun = new Date(config.lastRunAt);
    const intervalMs = config.intervalMinutes * 60 * 1000;
    const nextRun = new Date(lastRun.getTime() + intervalMs);
    const now = new Date();
    return now >= nextRun;
  }

  // No previous run, should run now
  return true;
}
