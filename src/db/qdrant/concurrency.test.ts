/**
 * Qdrant High-Concurrency Load Test
 *
 * Verifies that Qdrant operations do not block the Node.js event loop
 * under high concurrent load. Uses mocked Qdrant client to simulate
 * realistic async I/O behavior without requiring a live Qdrant instance.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@qdrant/js-client-rest', () => ({
  QdrantClient: vi.fn().mockImplementation(() => mockQdrantClient),
}));

vi.mock('./connection', async () => {
  const actual = await vi.importActual('./connection');
  return {
    ...actual,
    getQdrantClient: vi.fn(() => mockQdrantClient),
    collectionExists: vi.fn().mockResolvedValue(true),
  };
});

const mockQdrantClient = {
  upsert: vi.fn(),
  search: vi.fn(),
  query: vi.fn(),
  delete: vi.fn(),
  retrieve: vi.fn(),
  count: vi.fn(),
  getCollection: vi.fn(),
  getCollections: vi.fn(),
};

import {
  addDocument,
  addDocumentsBatch,
  search,
  hybridSearch,
  deleteDocument,
  getDocument,
  countDocuments,
} from './embeddings';
import type { QdrantCollectionName } from './connection';

const TEST_COLLECTION: QdrantCollectionName = 'approved_posts';
const SAMPLE_EMBEDDING: number[] = Array.from({ length: 1536 }, () => 0.1);
const SAMPLE_SPARSE = { indices: [1, 5, 10], values: [0.5, 0.3, 0.2] };

function measureEventLoopLag(): Promise<number> {
  const start = performance.now();
  return new Promise((resolve) => {
    setImmediate(() => {
      resolve(performance.now() - start);
    });
  });
}

async function measureEventLoopResponsiveness(
  durationMs: number,
  intervalMs: number = 10
): Promise<{ maxLag: number; avgLag: number; samples: number }> {
  const lagSamples: number[] = [];
  const endTime = Date.now() + durationMs;

  while (Date.now() < endTime) {
    const lag = await measureEventLoopLag();
    lagSamples.push(lag);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  const maxLag = Math.max(...lagSamples);
  const avgLag = lagSamples.reduce((a, b) => a + b, 0) / lagSamples.length;

  return { maxLag, avgLag, samples: lagSamples.length };
}

describe('Qdrant High-Concurrency Load Test', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockQdrantClient.upsert.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5 + Math.random() * 10));
      return { status: 'completed', operation_id: 1 };
    });

    mockQdrantClient.search.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5 + Math.random() * 15));
      return [
        {
          id: 'test-id',
          score: 0.95,
          payload: { text: 'test content', category: 'test' },
        },
      ];
    });

    mockQdrantClient.query.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10 + Math.random() * 20));
      return {
        points: [
          {
            id: 'test-id',
            score: 0.92,
            payload: { text: 'hybrid result', type: 'test' },
          },
        ],
      };
    });

    mockQdrantClient.delete.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 3 + Math.random() * 7));
      return { status: 'completed', operation_id: 2 };
    });

    mockQdrantClient.retrieve.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5 + Math.random() * 10));
      return [
        {
          id: 'test-id',
          payload: { text: 'retrieved content', meta: 'value' },
        },
      ];
    });

    mockQdrantClient.count.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2 + Math.random() * 5));
      return { count: 100 };
    });
  });

  afterEach(() => {
    // Don't use vi.restoreAllMocks() - it breaks vi.mock() factories
    // vi.clearAllMocks() in beforeEach is sufficient
  });

  describe('Event Loop Responsiveness', () => {
    it('maintains responsive event loop during 50 concurrent search operations', async () => {
      const CONCURRENT_OPS = 50;
      const MAX_ACCEPTABLE_LAG_MS = 100;

      let completedOps = 0;
      const lagPromise = measureEventLoopResponsiveness(500, 5);

      const operations = Array.from({ length: CONCURRENT_OPS }, (_) =>
        search(TEST_COLLECTION, SAMPLE_EMBEDDING, { limit: 10 }).then(() => {
          completedOps++;
        })
      );

      await Promise.all([...operations, lagPromise]);
      const lagStats = await lagPromise;

      expect(completedOps).toBe(CONCURRENT_OPS);
      expect(lagStats.maxLag).toBeLessThan(MAX_ACCEPTABLE_LAG_MS);
      expect(lagStats.avgLag).toBeLessThan(MAX_ACCEPTABLE_LAG_MS / 2);
    });

    it('maintains responsive event loop during 100 concurrent mixed operations', async () => {
      const CONCURRENT_OPS = 100;
      const MAX_ACCEPTABLE_LAG_MS = 150;

      let completedOps = 0;
      const lagPromise = measureEventLoopResponsiveness(800, 5);

      const operations = Array.from({ length: CONCURRENT_OPS }, (_, i) => {
        const opType = i % 5;
        switch (opType) {
          case 0:
            return addDocument(TEST_COLLECTION, `doc-${i}`, `content-${i}`, SAMPLE_EMBEDDING, {
              index: i,
            }).then(() => {
              completedOps++;
            });
          case 1:
            return search(TEST_COLLECTION, SAMPLE_EMBEDDING).then(() => {
              completedOps++;
            });
          case 2:
            return hybridSearch(TEST_COLLECTION, SAMPLE_EMBEDDING, SAMPLE_SPARSE).then(() => {
              completedOps++;
            });
          case 3:
            return getDocument(TEST_COLLECTION, `doc-${i}`).then(() => {
              completedOps++;
            });
          case 4:
            return countDocuments(TEST_COLLECTION).then(() => {
              completedOps++;
            });
          default:
            return Promise.resolve().then(() => {
              completedOps++;
            });
        }
      });

      await Promise.all([...operations, lagPromise]);
      const lagStats = await lagPromise;

      expect(completedOps).toBe(CONCURRENT_OPS);
      expect(lagStats.maxLag).toBeLessThan(MAX_ACCEPTABLE_LAG_MS);
    });

    it('handles burst of 200 search operations without blocking', async () => {
      const BURST_SIZE = 200;
      const MAX_ACCEPTABLE_LAG_MS = 200;

      const startTime = performance.now();
      let maxObservedLag = 0;

      const checkLag = async (): Promise<void> => {
        while (performance.now() - startTime < 1500) {
          const lag = await measureEventLoopLag();
          maxObservedLag = Math.max(maxObservedLag, lag);
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
      };

      const lagChecker = checkLag();

      const operations = Array.from({ length: BURST_SIZE }, (_) =>
        search(TEST_COLLECTION, SAMPLE_EMBEDDING, { limit: 5 })
      );

      await Promise.all([Promise.all(operations), lagChecker]);

      expect(maxObservedLag).toBeLessThan(MAX_ACCEPTABLE_LAG_MS);
      expect(mockQdrantClient.search).toHaveBeenCalledTimes(BURST_SIZE);
    });
  });

  describe('Batch Operations Under Load', () => {
    it('handles concurrent batch inserts without event loop blocking', async () => {
      const BATCH_COUNT = 10;
      const DOCS_PER_BATCH = 50;
      const MAX_ACCEPTABLE_LAG_MS = 150;

      const lagPromise = measureEventLoopResponsiveness(1000, 10);

      const batches = Array.from({ length: BATCH_COUNT }, (_, batchIdx) => {
        const docs = Array.from({ length: DOCS_PER_BATCH }, (__, docIdx) => ({
          id: `batch-${batchIdx}-doc-${docIdx}`,
          text: `content for batch ${batchIdx} doc ${docIdx}`,
          embedding: SAMPLE_EMBEDDING,
          metadata: { batch: batchIdx, doc: docIdx },
        }));
        return addDocumentsBatch(TEST_COLLECTION, docs);
      });

      await Promise.all([...batches, lagPromise]);
      const lagStats = await lagPromise;

      expect(lagStats.maxLag).toBeLessThan(MAX_ACCEPTABLE_LAG_MS);
      expect(mockQdrantClient.upsert).toHaveBeenCalledTimes(BATCH_COUNT);
    });
  });

  describe('Concurrent Read/Write Operations', () => {
    it('handles mixed read/write workload without blocking', async () => {
      const WRITE_OPS = 30;
      const READ_OPS = 70;
      const MAX_ACCEPTABLE_LAG_MS = 150;

      let writeCount = 0;
      let readCount = 0;

      const lagPromise = measureEventLoopResponsiveness(800, 5);

      const writes = Array.from({ length: WRITE_OPS }, (_, i) =>
        addDocument(TEST_COLLECTION, `write-${i}`, `content-${i}`, SAMPLE_EMBEDDING).then(() => {
          writeCount++;
        })
      );

      const reads = Array.from({ length: READ_OPS }, (_) =>
        search(TEST_COLLECTION, SAMPLE_EMBEDDING).then(() => {
          readCount++;
        })
      );

      await Promise.all([...writes, ...reads, lagPromise]);
      const lagStats = await lagPromise;

      expect(writeCount).toBe(WRITE_OPS);
      expect(readCount).toBe(READ_OPS);
      expect(lagStats.maxLag).toBeLessThan(MAX_ACCEPTABLE_LAG_MS);
    });

    it('interleaved add/delete operations remain non-blocking', async () => {
      const OPS_PER_TYPE = 40;
      const MAX_ACCEPTABLE_LAG_MS = 150;

      const lagPromise = measureEventLoopResponsiveness(600, 5);

      const interleaved = Array.from({ length: OPS_PER_TYPE * 2 }, (_, i) => {
        if (i % 2 === 0) {
          return addDocument(TEST_COLLECTION, `interleave-${i}`, `text-${i}`, SAMPLE_EMBEDDING);
        } else {
          return deleteDocument(TEST_COLLECTION, `interleave-${i - 1}`);
        }
      });

      await Promise.all([...interleaved, lagPromise]);
      const lagStats = await lagPromise;

      expect(lagStats.maxLag).toBeLessThan(MAX_ACCEPTABLE_LAG_MS);
    });
  });

  describe('Stress Test Scenarios', () => {
    it('sustained load of 500 operations over time', async () => {
      const TOTAL_OPS = 500;
      const BATCH_SIZE = 50;
      const MAX_ACCEPTABLE_LAG_MS = 200;

      let completedOps = 0;
      let maxLag = 0;

      for (let batch = 0; batch < TOTAL_OPS / BATCH_SIZE; batch++) {
        const lagBefore = await measureEventLoopLag();
        maxLag = Math.max(maxLag, lagBefore);

        const ops = Array.from({ length: BATCH_SIZE }, (_, i) => {
          const idx = batch * BATCH_SIZE + i;
          const opType = idx % 3;
          switch (opType) {
            case 0:
              return search(TEST_COLLECTION, SAMPLE_EMBEDDING);
            case 1:
              return getDocument(TEST_COLLECTION, `doc-${idx}`);
            case 2:
              return countDocuments(TEST_COLLECTION);
            default:
              return Promise.resolve();
          }
        });

        await Promise.all(ops);
        completedOps += BATCH_SIZE;

        const lagAfter = await measureEventLoopLag();
        maxLag = Math.max(maxLag, lagAfter);
      }

      expect(completedOps).toBe(TOTAL_OPS);
      expect(maxLag).toBeLessThan(MAX_ACCEPTABLE_LAG_MS);
    });

    it('rapid fire operations do not accumulate blocking', async () => {
      const RAPID_FIRE_COUNT = 300;
      const MAX_ACCEPTABLE_LAG_MS = 200;

      const lagSamples: number[] = [];

      for (let i = 0; i < RAPID_FIRE_COUNT; i++) {
        const searchPromise = search(TEST_COLLECTION, SAMPLE_EMBEDDING);

        if (i % 30 === 0) {
          const lag = await measureEventLoopLag();
          lagSamples.push(lag);
        }

        await searchPromise;
      }

      const maxLag = Math.max(...lagSamples);
      const avgLag = lagSamples.reduce((a, b) => a + b, 0) / lagSamples.length;

      expect(maxLag).toBeLessThan(MAX_ACCEPTABLE_LAG_MS);
      expect(avgLag).toBeLessThan(MAX_ACCEPTABLE_LAG_MS / 4);
    });
  });

  describe('Hybrid Search Concurrency', () => {
    it('concurrent hybrid searches remain non-blocking', async () => {
      const CONCURRENT_HYBRID = 50;
      const MAX_ACCEPTABLE_LAG_MS = 150;

      const lagPromise = measureEventLoopResponsiveness(600, 5);

      const hybridOps = Array.from({ length: CONCURRENT_HYBRID }, () =>
        hybridSearch(TEST_COLLECTION, SAMPLE_EMBEDDING, SAMPLE_SPARSE, {
          limit: 10,
          fusionType: 'rrf',
        })
      );

      await Promise.all([...hybridOps, lagPromise]);
      const lagStats = await lagPromise;

      expect(lagStats.maxLag).toBeLessThan(MAX_ACCEPTABLE_LAG_MS);
      expect(mockQdrantClient.query).toHaveBeenCalledTimes(CONCURRENT_HYBRID);
    });
  });
});
