import { getDb } from '@/db/connection';
import { listSources, getSourceById, countSources } from '@/db/models/sources';
import { type SchedulerConfig } from '@/db/models/scheduler-config';
import { Source } from '@/types';

interface SourceRotation {
  sourceId: number;
  lastUsedAt: string;
  useCount: number;
}

function getSourceRotation(sourceId: number): SourceRotation | null {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM scheduler_source_rotation WHERE source_id = ?');
  const row = stmt.get(sourceId) as
    | { source_id: number; last_used_at: string; use_count: number }
    | undefined;
  if (!row) return null;
  return {
    sourceId: row.source_id,
    lastUsedAt: row.last_used_at,
    useCount: row.use_count,
  };
}

function updateSourceRotation(sourceId: number): void {
  const db = getDb();
  const now = new Date().toISOString();

  const existing = getSourceRotation(sourceId);
  if (existing) {
    db.prepare(
      `
      UPDATE scheduler_source_rotation
      SET last_used_at = ?, use_count = use_count + 1
      WHERE source_id = ?
    `
    ).run(now, sourceId);
  } else {
    db.prepare(
      `
      INSERT INTO scheduler_source_rotation (source_id, last_used_at, use_count)
      VALUES (?, ?, 1)
    `
    ).run(sourceId, now);
  }
}

function getAllSourceRotations(): SourceRotation[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM scheduler_source_rotation ORDER BY last_used_at ASC')
    .all() as Array<{ source_id: number; last_used_at: string; use_count: number }>;
  return rows.map((row) => ({
    sourceId: row.source_id,
    lastUsedAt: row.last_used_at,
    useCount: row.use_count,
  }));
}

export interface SourceSelectionResult {
  source: Source;
  selectionReason: string;
}

export function selectSource(config: SchedulerConfig): SourceSelectionResult | null {
  const totalSources = countSources();
  if (totalSources === 0) {
    return null;
  }

  switch (config.sourceMode) {
    case 'round_robin':
      return selectRoundRobin();
    case 'random':
      return selectRandom();
    case 'weighted':
      return selectWeighted();
    case 'manual':
      return selectManual(config.manualSourceIds ?? []);
    default:
      return selectRoundRobin();
  }
}

function selectRoundRobin(): SourceSelectionResult | null {
  const sources = listSources({ limit: 100 });
  if (sources.length === 0) return null;

  const rotations = getAllSourceRotations();
  const rotationMap = new Map(rotations.map((r) => [r.sourceId, r]));

  // Find source with oldest last_used_at (or never used)
  let selectedSource: Source | null = null;
  let oldestTime: Date | null = null;

  for (const source of sources) {
    const rotation = rotationMap.get(source.id);
    if (!rotation) {
      // Never used - select this one
      selectedSource = source;
      break;
    }
    const lastUsed = new Date(rotation.lastUsedAt);
    if (oldestTime === null || lastUsed < oldestTime) {
      oldestTime = lastUsed;
      selectedSource = source;
    }
  }

  if (selectedSource === null) return null;

  updateSourceRotation(selectedSource.id);
  return {
    source: selectedSource,
    selectionReason: 'round_robin',
  };
}

function selectRandom(): SourceSelectionResult | null {
  const sources = listSources({ limit: 100 });
  if (sources.length === 0) return null;

  const randomIndex = Math.floor(Math.random() * sources.length);
  const selectedSource = sources[randomIndex];

  updateSourceRotation(selectedSource.id);
  return {
    source: selectedSource,
    selectionReason: 'random',
  };
}

function selectWeighted(): SourceSelectionResult | null {
  const sources = listSources({ limit: 100 });
  if (sources.length === 0) return null;

  // Weight by inverse use count - less used sources get higher weight
  const rotations = getAllSourceRotations();
  const rotationMap = new Map(rotations.map((r) => [r.sourceId, r]));

  const maxUseCount = Math.max(...rotations.map((r) => r.useCount), 1);

  const weights: Array<{ source: Source; weight: number }> = sources.map((source) => {
    const rotation = rotationMap.get(source.id);
    const useCount = rotation?.useCount ?? 0;
    // Higher weight for less used sources
    const weight = maxUseCount - useCount + 1;
    return { source, weight };
  });

  const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0);
  let randomValue = Math.random() * totalWeight;

  for (const { source, weight } of weights) {
    randomValue -= weight;
    if (randomValue <= 0) {
      updateSourceRotation(source.id);
      return {
        source,
        selectionReason: 'weighted',
      };
    }
  }

  // Fallback to first
  const fallback = weights[0].source;
  updateSourceRotation(fallback.id);
  return {
    source: fallback,
    selectionReason: 'weighted_fallback',
  };
}

function selectManual(manualSourceIds: number[]): SourceSelectionResult | null {
  if (manualSourceIds.length === 0) {
    return selectRoundRobin(); // Fallback
  }

  // Round-robin through manual sources
  const rotations = getAllSourceRotations();
  const rotationMap = new Map(rotations.map((r) => [r.sourceId, r]));

  let selectedId: number | null = null;
  let oldestTime: Date | null = null;

  for (const sourceId of manualSourceIds) {
    const rotation = rotationMap.get(sourceId);
    if (!rotation) {
      // Never used - select this one
      selectedId = sourceId;
      break;
    }
    const lastUsed = new Date(rotation.lastUsedAt);
    if (oldestTime === null || lastUsed < oldestTime) {
      oldestTime = lastUsed;
      selectedId = sourceId;
    }
  }

  if (selectedId === null) {
    selectedId = manualSourceIds[0];
  }

  const source = getSourceById(selectedId);
  if (!source) {
    // Source was deleted, try next
    const remaining = manualSourceIds.filter((id) => id !== selectedId);
    if (remaining.length > 0) {
      return selectManual(remaining);
    }
    return selectRoundRobin(); // Fallback
  }

  updateSourceRotation(source.id);
  return {
    source,
    selectionReason: 'manual',
  };
}

export function getSourceUsageStats(): Array<{
  sourceId: number;
  useCount: number;
  lastUsedAt: string | null;
}> {
  const sources = listSources({ limit: 100 });
  const rotations = getAllSourceRotations();
  const rotationMap = new Map(rotations.map((r) => [r.sourceId, r]));

  return sources.map((source) => {
    const rotation = rotationMap.get(source.id);
    return {
      sourceId: source.id,
      useCount: rotation?.useCount ?? 0,
      lastUsedAt: rotation?.lastUsedAt ?? null,
    };
  });
}
