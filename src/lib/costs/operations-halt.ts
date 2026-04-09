import { ApiName } from '@/types';
import { getCostTracker, BudgetWarningLevel, getWarningLevel } from './tracker';
import { createLogger } from '@/lib/logger';

const logger = createLogger('costs:operations-halt');

export type HaltReason = 'budget_exhausted' | 'manual' | 'error';

export interface HaltedOperation {
  apiName: ApiName;
  period: 'daily' | 'monthly';
  reason: HaltReason;
  haltedAt: string;
  used: number;
  limit: number;
}

export interface OperationsHaltStatus {
  halted: boolean;
  haltedApis: ApiName[];
  haltedOperations: HaltedOperation[];
  lastChecked: string;
}

const haltedOperations: Map<string, HaltedOperation> = new Map();
let manualHalt = false;

function getHaltKey(apiName: ApiName, period: 'daily' | 'monthly'): string {
  return `${apiName}:${period}`;
}

export function haltOperationsForApi(
  apiName: ApiName,
  period: 'daily' | 'monthly',
  reason: HaltReason,
  used: number,
  limit: number
): void {
  const key = getHaltKey(apiName, period);

  if (haltedOperations.has(key)) {
    return;
  }

  const haltedOp: HaltedOperation = {
    apiName,
    period,
    reason,
    haltedAt: new Date().toISOString(),
    used,
    limit,
  };

  haltedOperations.set(key, haltedOp);

  logger.warn('Operations halted for API', {
    apiName,
    period,
    reason,
    used,
    limit,
  });
}

export function resumeOperationsForApi(apiName: ApiName, period?: 'daily' | 'monthly'): void {
  if (period) {
    const key = getHaltKey(apiName, period);
    if (haltedOperations.has(key)) {
      haltedOperations.delete(key);
      logger.info('Operations resumed for API', { apiName, period });
    }
  } else {
    const keysToDelete: string[] = [];
    for (const key of haltedOperations.keys()) {
      if (key.startsWith(`${apiName}:`)) {
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      haltedOperations.delete(key);
    }
    if (keysToDelete.length > 0) {
      logger.info('All operations resumed for API', { apiName });
    }
  }
}

export function haltAllOperations(reason: HaltReason = 'manual'): void {
  manualHalt = true;
  logger.warn('All operations halted', { reason });
}

export function resumeAllOperations(): void {
  manualHalt = false;
  haltedOperations.clear();
  logger.info('All operations resumed');
}

export function isOperationHalted(apiName: ApiName): boolean {
  if (manualHalt) {
    return true;
  }

  for (const key of haltedOperations.keys()) {
    if (key.startsWith(`${apiName}:`)) {
      return true;
    }
  }

  return false;
}

export function isAnyOperationHalted(): boolean {
  return manualHalt || haltedOperations.size > 0;
}

export function getHaltedOperation(
  apiName: ApiName,
  period: 'daily' | 'monthly'
): HaltedOperation | null {
  const key = getHaltKey(apiName, period);
  return haltedOperations.get(key) ?? null;
}

export function getOperationsHaltStatus(): OperationsHaltStatus {
  const haltedApis = new Set<ApiName>();
  const operations: HaltedOperation[] = [];

  for (const op of haltedOperations.values()) {
    haltedApis.add(op.apiName);
    operations.push(op);
  }

  return {
    halted: manualHalt || haltedOperations.size > 0,
    haltedApis: Array.from(haltedApis),
    haltedOperations: operations,
    lastChecked: new Date().toISOString(),
  };
}

export interface BudgetExhaustedInfo {
  apiName: ApiName;
  period: 'daily' | 'monthly';
  used: number;
  limit: number;
  percentUsed: number;
}

export function checkAndHaltIfBudgetExhausted(): BudgetExhaustedInfo[] {
  const tracker = getCostTracker();
  const budgetSummary = tracker.getBudgetSummary();
  const exhaustedBudgets: BudgetExhaustedInfo[] = [];

  for (const status of budgetSummary) {
    if (status.exceeded) {
      const percentUsed = (status.used / status.limit) * 100;

      haltOperationsForApi(
        status.apiName,
        status.period,
        'budget_exhausted',
        status.used,
        status.limit
      );

      exhaustedBudgets.push({
        apiName: status.apiName,
        period: status.period,
        used: status.used,
        limit: status.limit,
        percentUsed,
      });
    }
  }

  return exhaustedBudgets;
}

export function checkAndResumeIfBudgetAvailable(): ApiName[] {
  const tracker = getCostTracker();
  const budgetSummary = tracker.getBudgetSummary();
  const resumedApis: ApiName[] = [];

  for (const status of budgetSummary) {
    if (!status.exceeded) {
      const key = getHaltKey(status.apiName, status.period);
      const haltedOp = haltedOperations.get(key);

      if (haltedOp && haltedOp.reason === 'budget_exhausted') {
        resumeOperationsForApi(status.apiName, status.period);
        if (!resumedApis.includes(status.apiName)) {
          resumedApis.push(status.apiName);
        }
      }
    }
  }

  return resumedApis;
}

export class OperationHaltedError extends Error {
  public readonly apiName: ApiName;
  public readonly haltedOperation: HaltedOperation | null;

  constructor(apiName: ApiName, haltedOperation: HaltedOperation | null) {
    const message = haltedOperation
      ? `Operations halted for ${apiName}: ${haltedOperation.reason} (${haltedOperation.period} budget - used $${haltedOperation.used.toFixed(2)} of $${haltedOperation.limit.toFixed(2)})`
      : `Operations halted for ${apiName}`;
    super(message);
    this.name = 'OperationHaltedError';
    this.apiName = apiName;
    this.haltedOperation = haltedOperation;
  }
}

export function ensureOperationAllowed(apiName: ApiName): void {
  if (manualHalt) {
    throw new OperationHaltedError(apiName, null);
  }

  for (const [key, op] of haltedOperations.entries()) {
    if (key.startsWith(`${apiName}:`)) {
      throw new OperationHaltedError(apiName, op);
    }
  }
}

export function shouldAllowOperation(apiName: ApiName): boolean {
  try {
    ensureOperationAllowed(apiName);
    return true;
  } catch {
    return false;
  }
}

export function getHaltWarningLevel(apiName: ApiName): BudgetWarningLevel | null {
  const tracker = getCostTracker();
  const summary = tracker.getCostSummary(apiName);

  let highestLevel: BudgetWarningLevel | null = null;

  if (summary.dailyPercentUsed !== undefined) {
    const level = getWarningLevel(summary.dailyPercentUsed / 100);
    if (level === 'critical' || highestLevel === null) {
      highestLevel = level;
    }
  }

  if (summary.monthlyPercentUsed !== undefined) {
    const level = getWarningLevel(summary.monthlyPercentUsed / 100);
    if (level === 'critical' || (highestLevel !== 'critical' && level === 'high')) {
      highestLevel = level;
    }
  }

  return highestLevel;
}

export function formatHaltStatus(status: OperationsHaltStatus): string {
  if (!status.halted) {
    return 'All operations running normally.';
  }

  const lines: string[] = ['⚠️ Operations Halted:'];

  for (const op of status.haltedOperations) {
    const percentUsed = ((op.used / op.limit) * 100).toFixed(1);
    lines.push(
      `  - ${op.apiName} (${op.period}): ${op.reason} - $${op.used.toFixed(2)} / $${op.limit.toFixed(2)} (${percentUsed}%)`
    );
  }

  return lines.join('\n');
}

export function resetHaltState(): void {
  manualHalt = false;
  haltedOperations.clear();
}
