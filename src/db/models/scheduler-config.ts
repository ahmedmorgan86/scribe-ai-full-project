import { getDb } from '../connection';

export type SourceMode = 'round_robin' | 'random' | 'weighted' | 'manual';

export interface SchedulerConfig {
  id: number;
  enabled: boolean;
  intervalMinutes: number;
  maxQueueSize: number;
  sourceMode: SourceMode;
  manualSourceIds: number[] | null;
  timeSlots: string[] | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SchedulerConfigRow {
  id: number;
  enabled: number;
  interval_minutes: number;
  max_queue_size: number;
  source_mode: string;
  manual_source_ids: string | null;
  time_slots: string | null;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToConfig(row: SchedulerConfigRow): SchedulerConfig {
  return {
    id: row.id,
    enabled: row.enabled === 1,
    intervalMinutes: row.interval_minutes,
    maxQueueSize: row.max_queue_size,
    sourceMode: row.source_mode as SourceMode,
    manualSourceIds: row.manual_source_ids ? (JSON.parse(row.manual_source_ids) as number[]) : null,
    timeSlots: row.time_slots ? (JSON.parse(row.time_slots) as string[]) : null,
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getSchedulerConfig(): SchedulerConfig {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM scheduler_config WHERE id = 1');
  const row = stmt.get() as SchedulerConfigRow;
  return rowToConfig(row);
}

export interface UpdateSchedulerConfigInput {
  enabled?: boolean;
  intervalMinutes?: number;
  maxQueueSize?: number;
  sourceMode?: SourceMode;
  manualSourceIds?: number[] | null;
  timeSlots?: string[] | null;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
}

export function updateSchedulerConfig(input: UpdateSchedulerConfigInput): SchedulerConfig {
  const db = getDb();
  const updates: string[] = [];
  const values: (string | number | null)[] = [];

  if (input.enabled !== undefined) {
    updates.push('enabled = ?');
    values.push(input.enabled ? 1 : 0);
  }
  if (input.intervalMinutes !== undefined) {
    updates.push('interval_minutes = ?');
    values.push(input.intervalMinutes);
  }
  if (input.maxQueueSize !== undefined) {
    updates.push('max_queue_size = ?');
    values.push(input.maxQueueSize);
  }
  if (input.sourceMode !== undefined) {
    updates.push('source_mode = ?');
    values.push(input.sourceMode);
  }
  if (input.manualSourceIds !== undefined) {
    updates.push('manual_source_ids = ?');
    values.push(input.manualSourceIds ? JSON.stringify(input.manualSourceIds) : null);
  }
  if (input.timeSlots !== undefined) {
    updates.push('time_slots = ?');
    values.push(input.timeSlots ? JSON.stringify(input.timeSlots) : null);
  }
  if (input.lastRunAt !== undefined) {
    updates.push('last_run_at = ?');
    values.push(input.lastRunAt);
  }
  if (input.nextRunAt !== undefined) {
    updates.push('next_run_at = ?');
    values.push(input.nextRunAt);
  }

  if (updates.length > 0) {
    updates.push("updated_at = datetime('now')");
    const sql = `UPDATE scheduler_config SET ${updates.join(', ')} WHERE id = 1`;
    db.prepare(sql).run(...values);
  }

  return getSchedulerConfig();
}

export function calculateNextRunTime(config: SchedulerConfig): Date {
  const now = new Date();
  const nextRun = new Date(now.getTime() + config.intervalMinutes * 60 * 1000);

  // If time slots are configured, find the next valid slot
  if (config.timeSlots && config.timeSlots.length > 0) {
    const validSlots = config.timeSlots
      .map((slot) => {
        const [hours, minutes] = slot.split(':').map(Number);
        const slotTime = new Date(now);
        slotTime.setHours(hours, minutes, 0, 0);
        // If slot is in the past today, add a day
        if (slotTime <= now) {
          slotTime.setDate(slotTime.getDate() + 1);
        }
        return slotTime;
      })
      .sort((a, b) => a.getTime() - b.getTime());

    if (validSlots.length > 0) {
      return validSlots[0];
    }
  }

  return nextRun;
}
