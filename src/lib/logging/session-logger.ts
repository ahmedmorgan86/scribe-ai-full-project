import fs from 'fs';
import path from 'path';

export interface SessionLogEntry {
  sourceId: number | null;
  patternsUsed: number[];
  attempts: number;
  finalStatus: 'success' | 'failed' | 'rejected' | 'timeout';
  durationMs: number;
  timestamp: string;
  postId?: number;
  errorType?: string;
}

const LOG_FILE = path.resolve(process.cwd(), 'logs', 'generation-sessions.jsonl');

function ensureLogDirectory(): void {
  const dir = path.dirname(LOG_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Logs a generation session to the JSONL file for debugging and analysis.
 */
export function logGenerationSession(entry: Omit<SessionLogEntry, 'timestamp'>): void {
  ensureLogDirectory();

  const logEntry: SessionLogEntry = {
    ...entry,
    timestamp: new Date().toISOString(),
  };

  const line = JSON.stringify(logEntry) + '\n';
  fs.appendFileSync(LOG_FILE, line);
}

/**
 * Creates a session tracker for tracking generation attempts.
 */
export function createSessionTracker(sourceId: number | null): SessionTracker {
  return new SessionTracker(sourceId);
}

export class SessionTracker {
  private sourceId: number | null;
  private patternsUsed: Set<number> = new Set();
  private attempts = 0;
  private startTime: number;

  constructor(sourceId: number | null) {
    this.sourceId = sourceId;
    this.startTime = Date.now();
  }

  recordAttempt(patternIds?: number[]): void {
    this.attempts++;
    if (patternIds) {
      patternIds.forEach((id) => this.patternsUsed.add(id));
    }
  }

  complete(
    status: SessionLogEntry['finalStatus'],
    options?: { postId?: number; errorType?: string }
  ): void {
    const durationMs = Date.now() - this.startTime;
    logGenerationSession({
      sourceId: this.sourceId,
      patternsUsed: Array.from(this.patternsUsed),
      attempts: this.attempts,
      finalStatus: status,
      durationMs,
      postId: options?.postId,
      errorType: options?.errorType,
    });
  }
}

/**
 * Reads recent session logs for analysis.
 */
export function readRecentSessions(limit: number = 100): SessionLogEntry[] {
  if (!fs.existsSync(LOG_FILE)) {
    return [];
  }

  const content = fs.readFileSync(LOG_FILE, 'utf-8');
  const lines = content.trim().split('\n').filter(Boolean);
  const entries: SessionLogEntry[] = [];

  // Read from end for recency
  for (let i = lines.length - 1; i >= 0 && entries.length < limit; i--) {
    try {
      entries.push(JSON.parse(lines[i]) as SessionLogEntry);
    } catch {
      // Skip malformed lines
    }
  }

  return entries;
}

/**
 * Gets session statistics for monitoring.
 */
export function getSessionStats(since?: Date): {
  total: number;
  byStatus: Record<string, number>;
  avgDurationMs: number;
  avgAttempts: number;
} {
  const sessions = readRecentSessions(1000);
  const sinceTs = since?.toISOString();

  const filtered = sinceTs ? sessions.filter((s) => s.timestamp >= sinceTs) : sessions;

  if (filtered.length === 0) {
    return {
      total: 0,
      byStatus: {},
      avgDurationMs: 0,
      avgAttempts: 0,
    };
  }

  const byStatus: Record<string, number> = {};
  let totalDuration = 0;
  let totalAttempts = 0;

  for (const session of filtered) {
    byStatus[session.finalStatus] = (byStatus[session.finalStatus] ?? 0) + 1;
    totalDuration += session.durationMs;
    totalAttempts += session.attempts;
  }

  return {
    total: filtered.length,
    byStatus,
    avgDurationMs: totalDuration / filtered.length,
    avgAttempts: totalAttempts / filtered.length,
  };
}

/**
 * Clears the session log file.
 */
export function clearSessionLogs(): void {
  if (fs.existsSync(LOG_FILE)) {
    fs.unlinkSync(LOG_FILE);
  }
}
