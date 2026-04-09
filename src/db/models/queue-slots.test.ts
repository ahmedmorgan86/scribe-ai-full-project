import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { closeDb, resetDb } from '@/db/connection';
import { runMigrations } from '@/db/migrations';
import {
  createQueueSlot,
  getQueueSlotById,
  updateQueueSlot,
  deleteQueueSlot,
  listQueueSlots,
  getNextAvailableSlot,
  scheduleToNextSlot,
  seedDefaultSlots,
} from './queue-slots';
import { createQueueItem, getQueueItemByPostId } from './queue';
import { createPost } from './posts';

const TEST_DB_PATH = './data/test-queue-slots.db';

beforeAll(() => {
  process.env.SQLITE_DB_PATH = TEST_DB_PATH;
});

afterAll(() => {
  closeDb();
  resetDb();
  delete process.env.SQLITE_DB_PATH;
});

describe('queue-slots', () => {
  beforeEach(() => {
    resetDb();
    runMigrations();
  });

  afterEach(() => {
    closeDb();
  });

  describe('createQueueSlot', () => {
    it('creates a slot with required fields', () => {
      const slot = createQueueSlot({
        dayOfWeek: 1, // Monday
        timeUtc: '09:00',
      });

      expect(slot.id).toBeDefined();
      expect(slot.dayOfWeek).toBe(1);
      expect(slot.timeUtc).toBe('09:00');
      expect(slot.enabled).toBe(true);
    });

    it('creates a disabled slot', () => {
      const slot = createQueueSlot({
        dayOfWeek: 2,
        timeUtc: '14:30',
        enabled: false,
      });

      expect(slot.enabled).toBe(false);
    });
  });

  describe('getQueueSlotById', () => {
    it('returns slot by id', () => {
      const created = createQueueSlot({ dayOfWeek: 1, timeUtc: '10:00' });
      const found = getQueueSlotById(created.id);

      expect(found).not.toBeNull();
      expect(found?.id).toBe(created.id);
    });

    it('returns null for non-existent id', () => {
      const found = getQueueSlotById('non-existent-id');
      expect(found).toBeNull();
    });
  });

  describe('updateQueueSlot', () => {
    it('updates slot fields', () => {
      const slot = createQueueSlot({ dayOfWeek: 1, timeUtc: '09:00' });

      const updated = updateQueueSlot(slot.id, {
        dayOfWeek: 3,
        timeUtc: '15:00',
        enabled: false,
      });

      expect(updated).not.toBeNull();
      expect(updated?.dayOfWeek).toBe(3);
      expect(updated?.timeUtc).toBe('15:00');
      expect(updated?.enabled).toBe(false);
    });

    it('returns null for non-existent id', () => {
      const updated = updateQueueSlot('non-existent', { enabled: false });
      expect(updated).toBeNull();
    });
  });

  describe('deleteQueueSlot', () => {
    it('deletes existing slot', () => {
      const slot = createQueueSlot({ dayOfWeek: 1, timeUtc: '09:00' });

      const deleted = deleteQueueSlot(slot.id);
      expect(deleted).toBe(true);

      const found = getQueueSlotById(slot.id);
      expect(found).toBeNull();
    });

    it('returns false for non-existent id', () => {
      const deleted = deleteQueueSlot('non-existent');
      expect(deleted).toBe(false);
    });
  });

  describe('listQueueSlots', () => {
    it('returns empty array when no slots', () => {
      const slots = listQueueSlots();
      expect(slots).toEqual([]);
    });

    it('returns all slots ordered by day and time', () => {
      createQueueSlot({ dayOfWeek: 3, timeUtc: '14:00' });
      createQueueSlot({ dayOfWeek: 1, timeUtc: '09:00' });
      createQueueSlot({ dayOfWeek: 1, timeUtc: '12:00' });

      const slots = listQueueSlots();
      expect(slots.length).toBe(3);
      expect(slots[0].dayOfWeek).toBe(1);
      expect(slots[0].timeUtc).toBe('09:00');
      expect(slots[1].timeUtc).toBe('12:00');
      expect(slots[2].dayOfWeek).toBe(3);
    });

    it('filters by dayOfWeek', () => {
      createQueueSlot({ dayOfWeek: 1, timeUtc: '09:00' });
      createQueueSlot({ dayOfWeek: 2, timeUtc: '09:00' });
      createQueueSlot({ dayOfWeek: 1, timeUtc: '12:00' });

      const mondaySlots = listQueueSlots({ dayOfWeek: 1 });
      expect(mondaySlots.length).toBe(2);
    });

    it('filters enabled only', () => {
      createQueueSlot({ dayOfWeek: 1, timeUtc: '09:00', enabled: true });
      createQueueSlot({ dayOfWeek: 1, timeUtc: '12:00', enabled: false });
      createQueueSlot({ dayOfWeek: 1, timeUtc: '15:00', enabled: true });

      const enabledSlots = listQueueSlots({ enabledOnly: true });
      expect(enabledSlots.length).toBe(2);
    });
  });

  describe('getNextAvailableSlot', () => {
    it('returns null when no enabled slots', () => {
      const next = getNextAvailableSlot();
      expect(next).toBeNull();
    });

    it('returns next available slot', () => {
      // Create slots for all days
      for (let day = 0; day < 7; day++) {
        createQueueSlot({ dayOfWeek: day, timeUtc: '09:00' });
        createQueueSlot({ dayOfWeek: day, timeUtc: '17:00' });
      }

      const next = getNextAvailableSlot();
      expect(next).not.toBeNull();
      expect(next instanceof Date).toBe(true);
    });
  });

  describe('scheduleToNextSlot', () => {
    it('schedules post to next available slot', () => {
      // Create a post and queue item
      const post = createPost({
        content: 'Test post',
        type: 'single',
        confidenceScore: 0.9,
        reasoning: {
          source: 'test',
          whyItWorks: 'test',
          voiceMatch: 0.9,
          timing: 'now',
          concerns: [],
        },
      });
      createQueueItem({ postId: post.id });

      // Create a slot
      const now = new Date();
      const futureHour = (now.getUTCHours() + 2) % 24;
      createQueueSlot({
        dayOfWeek: now.getUTCDay(),
        timeUtc: `${String(futureHour).padStart(2, '0')}:00`,
      });

      const scheduled = scheduleToNextSlot(post.id);
      expect(scheduled).not.toBeNull();

      const queueItem = getQueueItemByPostId(post.id);
      expect(queueItem?.scheduledFor).toBeDefined();
    });

    it('returns null when no slots available', () => {
      const post = createPost({
        content: 'Test post',
        type: 'single',
        confidenceScore: 0.9,
        reasoning: {
          source: 'test',
          whyItWorks: 'test',
          voiceMatch: 0.9,
          timing: 'now',
          concerns: [],
        },
      });
      createQueueItem({ postId: post.id });

      const scheduled = scheduleToNextSlot(post.id);
      expect(scheduled).toBeNull();
    });
  });

  describe('seedDefaultSlots', () => {
    it('creates default slots for weekdays', () => {
      const seeded = seedDefaultSlots();
      expect(seeded).toBe(15); // 5 days x 3 times

      const slots = listQueueSlots();
      expect(slots.length).toBe(15);
    });

    it('does not create slots if some exist', () => {
      createQueueSlot({ dayOfWeek: 1, timeUtc: '09:00' });

      const seeded = seedDefaultSlots();
      expect(seeded).toBe(0);
    });
  });
});
