import { getDb } from '../connection';
import { randomUUID } from 'crypto';

export interface QueueSlot {
  id: string;
  dayOfWeek: number; // 0 = Sunday, 6 = Saturday
  timeUtc: string; // HH:mm format
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface QueueSlotRow {
  id: string;
  day_of_week: number;
  time_utc: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

function rowToQueueSlot(row: QueueSlotRow): QueueSlot {
  return {
    id: row.id,
    dayOfWeek: row.day_of_week,
    timeUtc: row.time_utc,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateQueueSlotInput {
  dayOfWeek: number;
  timeUtc: string;
  enabled?: boolean;
}

export interface UpdateQueueSlotInput {
  dayOfWeek?: number;
  timeUtc?: string;
  enabled?: boolean;
}

export function createQueueSlot(input: CreateQueueSlotInput): QueueSlot {
  const db = getDb();
  const id = randomUUID();

  const stmt = db.prepare(`
    INSERT INTO queue_slots (id, day_of_week, time_utc, enabled)
    VALUES (?, ?, ?, ?)
  `);

  stmt.run(id, input.dayOfWeek, input.timeUtc, input.enabled !== false ? 1 : 0);

  const slot = getQueueSlotById(id);
  if (!slot) {
    throw new Error('Failed to create queue slot');
  }
  return slot;
}

export function getQueueSlotById(id: string): QueueSlot | null {
  const db = getDb();
  const stmt = db.prepare(`SELECT * FROM queue_slots WHERE id = ?`);
  const row = stmt.get(id) as QueueSlotRow | undefined;
  return row ? rowToQueueSlot(row) : null;
}

export function updateQueueSlot(id: string, input: UpdateQueueSlotInput): QueueSlot | null {
  const db = getDb();
  const setClauses: string[] = [];
  const values: (string | number)[] = [];

  if (input.dayOfWeek !== undefined) {
    setClauses.push('day_of_week = ?');
    values.push(input.dayOfWeek);
  }
  if (input.timeUtc !== undefined) {
    setClauses.push('time_utc = ?');
    values.push(input.timeUtc);
  }
  if (input.enabled !== undefined) {
    setClauses.push('enabled = ?');
    values.push(input.enabled ? 1 : 0);
  }

  if (setClauses.length === 0) {
    return getQueueSlotById(id);
  }

  setClauses.push("updated_at = datetime('now')");
  values.push(id);

  const stmt = db.prepare(`UPDATE queue_slots SET ${setClauses.join(', ')} WHERE id = ?`);
  const result = stmt.run(...values);

  return result.changes > 0 ? getQueueSlotById(id) : null;
}

export function deleteQueueSlot(id: string): boolean {
  const db = getDb();
  const stmt = db.prepare(`DELETE FROM queue_slots WHERE id = ?`);
  const result = stmt.run(id);
  return result.changes > 0;
}

export interface ListQueueSlotsOptions {
  dayOfWeek?: number;
  enabledOnly?: boolean;
}

export function listQueueSlots(options: ListQueueSlotsOptions = {}): QueueSlot[] {
  const db = getDb();
  const { dayOfWeek, enabledOnly = false } = options;

  const whereClauses: string[] = [];
  const params: number[] = [];

  if (dayOfWeek !== undefined) {
    whereClauses.push('day_of_week = ?');
    params.push(dayOfWeek);
  }
  if (enabledOnly) {
    whereClauses.push('enabled = 1');
  }

  let query = `SELECT * FROM queue_slots`;
  if (whereClauses.length > 0) {
    query += ` WHERE ${whereClauses.join(' AND ')}`;
  }
  query += ` ORDER BY day_of_week ASC, time_utc ASC`;

  const stmt = db.prepare(query);
  const rows = stmt.all(...params) as QueueSlotRow[];
  return rows.map(rowToQueueSlot);
}

/**
 * Gets the next available slot from now.
 * Returns null if no enabled slots exist.
 */
export function getNextAvailableSlot(): Date | null {
  const enabledSlots = listQueueSlots({ enabledOnly: true });
  if (enabledSlots.length === 0) {
    return null;
  }

  const now = new Date();
  const currentDay = now.getUTCDay();
  const currentTime = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`;

  // Look for next slot in the next 7 days
  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    const targetDay = (currentDay + dayOffset) % 7;
    const slotsForDay = enabledSlots.filter((s) => s.dayOfWeek === targetDay);

    for (const slot of slotsForDay) {
      // For today, only consider times after now
      if (dayOffset === 0 && slot.timeUtc <= currentTime) {
        continue;
      }

      const [hours, minutes] = slot.timeUtc.split(':').map(Number);
      const slotDate = new Date(now);
      slotDate.setUTCDate(slotDate.getUTCDate() + dayOffset);
      slotDate.setUTCHours(hours, minutes, 0, 0);

      return slotDate;
    }
  }

  // If no slot found in next 7 days, get first slot of the week
  const firstSlot = enabledSlots[0];
  const [hours, minutes] = firstSlot.timeUtc.split(':').map(Number);
  const nextWeekDate = new Date(now);
  const daysUntilSlot = (firstSlot.dayOfWeek - currentDay + 7) % 7 || 7;
  nextWeekDate.setUTCDate(nextWeekDate.getUTCDate() + daysUntilSlot);
  nextWeekDate.setUTCHours(hours, minutes, 0, 0);

  return nextWeekDate;
}

/**
 * Schedules a post to the next available slot.
 * Returns the scheduled time or null if no slots available.
 */
export function scheduleToNextSlot(postId: number): Date | null {
  const nextSlot = getNextAvailableSlot();
  if (!nextSlot) {
    return null;
  }

  // Update the queue item with the scheduled time
  const db = getDb();
  const stmt = db.prepare(`
    UPDATE queue SET scheduled_for = ? WHERE post_id = ?
  `);
  stmt.run(nextSlot.toISOString(), postId);

  return nextSlot;
}

/**
 * Seeds default slots if none exist.
 */
export function seedDefaultSlots(): number {
  const existing = listQueueSlots();
  if (existing.length > 0) {
    return 0;
  }

  // Default slots: Mon-Fri at 9am, 12pm, 5pm UTC
  const defaultTimes = ['09:00', '12:00', '17:00'];
  let created = 0;

  for (let day = 1; day <= 5; day++) {
    // Monday (1) to Friday (5)
    for (const time of defaultTimes) {
      createQueueSlot({ dayOfWeek: day, timeUtc: time, enabled: true });
      created++;
    }
  }

  return created;
}
