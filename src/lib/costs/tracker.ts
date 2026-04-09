import {
  createCostEntry,
  getDailyCost,
  getMonthlyCost,
  getTotalCostForPeriod,
  getTotalTokensForPeriod,
  listCostEntries,
  checkBudgetLimit,
  isBudgetExceeded,
  getBudgetSummary,
  getDailyCostsByModel,
  getMonthlyCostsByModel,
  getCostsByModel,
  getTotalCostForModel,
  BudgetLimits,
  BudgetStatus,
  ModelCostSummary,
} from '@/db/models/costs';
import { getDb } from '@/db/connection';
import { ApiName, CostEntry } from '@/types';
import { createLogger } from '@/lib/logger';

const logger = createLogger('costs:tracker');

export const BUDGET_WARNING_THRESHOLDS = {
  LOW: 0.5,
  MEDIUM: 0.8,
  HIGH: 0.95,
} as const;

export const DEFAULT_WARNING_THRESHOLDS = [
  BUDGET_WARNING_THRESHOLDS.LOW,
  BUDGET_WARNING_THRESHOLDS.MEDIUM,
  BUDGET_WARNING_THRESHOLDS.HIGH,
] as const;

export type BudgetWarningLevel = 'low' | 'medium' | 'high' | 'critical';

export function getWarningLevel(percentUsed: number): BudgetWarningLevel {
  if (percentUsed >= 1.0) return 'critical';
  if (percentUsed >= BUDGET_WARNING_THRESHOLDS.HIGH) return 'high';
  if (percentUsed >= BUDGET_WARNING_THRESHOLDS.MEDIUM) return 'medium';
  if (percentUsed >= BUDGET_WARNING_THRESHOLDS.LOW) return 'low';
  return 'low';
}

export function isWarningThresholdMet(percentUsed: number): boolean {
  return percentUsed >= BUDGET_WARNING_THRESHOLDS.LOW;
}

export interface CostTrackerConfig {
  anthropicDailyBudgetUsd?: number;
  anthropicMonthlyBudgetUsd?: number;
  apifyDailyBudgetUsd?: number;
  apifyMonthlyBudgetUsd?: number;
  smaugMonthlyBudgetUsd?: number;
  warningThresholds?: number[];
}

export interface CostSummary {
  apiName: ApiName;
  dailyCost: number;
  monthlyCost: number;
  dailyLimit?: number;
  monthlyLimit?: number;
  dailyRemaining?: number;
  monthlyRemaining?: number;
  dailyPercentUsed?: number;
  monthlyPercentUsed?: number;
}

export interface AggregatedCostSummary {
  byApi: CostSummary[];
  totalDailyCost: number;
  totalMonthlyCost: number;
  timestamp: string;
}

export interface BudgetWarning {
  apiName: ApiName;
  period: 'daily' | 'monthly';
  percentUsed: number;
  threshold: number;
  used: number;
  limit: number;
}

export interface CostTrackingResult {
  entry: CostEntry;
  budgetWarnings: BudgetWarning[];
  budgetExceeded: boolean;
}

export class CostTracker {
  private config: CostTrackerConfig;
  private warningThresholds: number[];

  constructor(config?: CostTrackerConfig) {
    this.config = config ?? this.loadConfigFromEnv();
    this.warningThresholds = this.config.warningThresholds ?? [...DEFAULT_WARNING_THRESHOLDS];
  }

  private loadConfigFromEnv(): CostTrackerConfig {
    return {
      anthropicDailyBudgetUsd: this.parseEnvFloat('ANTHROPIC_DAILY_BUDGET_USD'),
      anthropicMonthlyBudgetUsd: this.parseEnvFloat('ANTHROPIC_MONTHLY_BUDGET_USD'),
      apifyDailyBudgetUsd: this.parseEnvFloat('APIFY_DAILY_BUDGET_USD'),
      apifyMonthlyBudgetUsd: this.parseEnvFloat('APIFY_MONTHLY_BUDGET_USD'),
      smaugMonthlyBudgetUsd: this.parseEnvFloat('SMAUG_MONTHLY_BUDGET_USD'),
    };
  }

  private parseEnvFloat(key: string): number | undefined {
    const value = process.env[key];
    if (value === undefined || value === '') return undefined;
    const parsed = parseFloat(value);
    return isNaN(parsed) ? undefined : parsed;
  }

  private getBudgetLimits(): BudgetLimits {
    return {
      anthropicDailyUsd: this.config.anthropicDailyBudgetUsd,
      anthropicMonthlyUsd: this.config.anthropicMonthlyBudgetUsd,
      apifyDailyUsd: this.config.apifyDailyBudgetUsd,
      apifyMonthlyUsd: this.config.apifyMonthlyBudgetUsd,
      smaugMonthlyUsd: this.config.smaugMonthlyBudgetUsd,
    };
  }

  trackCost(
    apiName: ApiName,
    costUsd: number,
    tokensUsed?: number,
    modelId?: string
  ): CostTrackingResult {
    const entry = createCostEntry({
      apiName,
      modelId,
      costUsd,
      tokensUsed,
    });

    const budgetWarnings = this.checkBudgetWarnings(apiName);
    const budgetExceeded = this.isBudgetExceeded(apiName, 0);

    if (budgetWarnings.length > 0) {
      logger.warn('Budget warning triggered', { apiName, modelId, warnings: budgetWarnings });
    }

    if (budgetExceeded) {
      logger.error('Budget exceeded', new Error('Budget exceeded'), { apiName, modelId });
    }

    return { entry, budgetWarnings, budgetExceeded };
  }

  getModelCostSummary(startDate?: string, endDate?: string): ModelCostSummary[] {
    return getCostsByModel(startDate, endDate);
  }

  getDailyModelCosts(): ModelCostSummary[] {
    return getDailyCostsByModel();
  }

  getMonthlyModelCosts(): ModelCostSummary[] {
    return getMonthlyCostsByModel();
  }

  getCostForModel(modelId: string, startDate?: string, endDate?: string): number {
    return getTotalCostForModel(modelId, startDate, endDate);
  }

  checkBudgetBeforeOperation(apiName: ApiName, estimatedCost: number): BudgetStatus[] {
    const limits = this.getBudgetLimits();
    return checkBudgetLimit(apiName, estimatedCost, limits);
  }

  isBudgetExceeded(apiName: ApiName, proposedCost: number): boolean {
    const limits = this.getBudgetLimits();
    return isBudgetExceeded(apiName, proposedCost, limits);
  }

  checkBudgetWarnings(apiName: ApiName): BudgetWarning[] {
    const warnings: BudgetWarning[] = [];
    const limits = this.getBudgetLimits();

    if (apiName === 'anthropic') {
      if (limits.anthropicDailyUsd !== undefined) {
        const daily = getDailyCost('anthropic');
        const percent = daily / limits.anthropicDailyUsd;
        this.addWarningsIfThresholdMet(
          warnings,
          'anthropic',
          'daily',
          percent,
          daily,
          limits.anthropicDailyUsd
        );
      }
      if (limits.anthropicMonthlyUsd !== undefined) {
        const monthly = getMonthlyCost('anthropic');
        const percent = monthly / limits.anthropicMonthlyUsd;
        this.addWarningsIfThresholdMet(
          warnings,
          'anthropic',
          'monthly',
          percent,
          monthly,
          limits.anthropicMonthlyUsd
        );
      }
    }

    if (apiName === 'apify') {
      if (limits.apifyDailyUsd !== undefined) {
        const daily = getDailyCost('apify');
        const percent = daily / limits.apifyDailyUsd;
        this.addWarningsIfThresholdMet(
          warnings,
          'apify',
          'daily',
          percent,
          daily,
          limits.apifyDailyUsd
        );
      }
      if (limits.apifyMonthlyUsd !== undefined) {
        const monthly = getMonthlyCost('apify');
        const percent = monthly / limits.apifyMonthlyUsd;
        this.addWarningsIfThresholdMet(
          warnings,
          'apify',
          'monthly',
          percent,
          monthly,
          limits.apifyMonthlyUsd
        );
      }
    }

    if (apiName === 'smaug' && limits.smaugMonthlyUsd !== undefined) {
      const monthly = getMonthlyCost('smaug');
      const percent = monthly / limits.smaugMonthlyUsd;
      this.addWarningsIfThresholdMet(
        warnings,
        'smaug',
        'monthly',
        percent,
        monthly,
        limits.smaugMonthlyUsd
      );
    }

    return warnings;
  }

  private addWarningsIfThresholdMet(
    warnings: BudgetWarning[],
    apiName: ApiName,
    period: 'daily' | 'monthly',
    percentUsed: number,
    used: number,
    limit: number
  ): void {
    for (const threshold of this.warningThresholds) {
      if (percentUsed >= threshold) {
        warnings.push({
          apiName,
          period,
          percentUsed,
          threshold,
          used,
          limit,
        });
      }
    }
  }

  getCostSummary(apiName: ApiName): CostSummary {
    const limits = this.getBudgetLimits();
    const dailyCost = getDailyCost(apiName);
    const monthlyCost = getMonthlyCost(apiName);

    const summary: CostSummary = {
      apiName,
      dailyCost,
      monthlyCost,
    };

    if (apiName === 'anthropic') {
      if (limits.anthropicDailyUsd !== undefined) {
        summary.dailyLimit = limits.anthropicDailyUsd;
        summary.dailyRemaining = Math.max(0, limits.anthropicDailyUsd - dailyCost);
        summary.dailyPercentUsed = (dailyCost / limits.anthropicDailyUsd) * 100;
      }
      if (limits.anthropicMonthlyUsd !== undefined) {
        summary.monthlyLimit = limits.anthropicMonthlyUsd;
        summary.monthlyRemaining = Math.max(0, limits.anthropicMonthlyUsd - monthlyCost);
        summary.monthlyPercentUsed = (monthlyCost / limits.anthropicMonthlyUsd) * 100;
      }
    }

    if (apiName === 'apify') {
      if (limits.apifyDailyUsd !== undefined) {
        summary.dailyLimit = limits.apifyDailyUsd;
        summary.dailyRemaining = Math.max(0, limits.apifyDailyUsd - dailyCost);
        summary.dailyPercentUsed = (dailyCost / limits.apifyDailyUsd) * 100;
      }
      if (limits.apifyMonthlyUsd !== undefined) {
        summary.monthlyLimit = limits.apifyMonthlyUsd;
        summary.monthlyRemaining = Math.max(0, limits.apifyMonthlyUsd - monthlyCost);
        summary.monthlyPercentUsed = (monthlyCost / limits.apifyMonthlyUsd) * 100;
      }
    }

    if (apiName === 'smaug' && limits.smaugMonthlyUsd !== undefined) {
      summary.monthlyLimit = limits.smaugMonthlyUsd;
      summary.monthlyRemaining = Math.max(0, limits.smaugMonthlyUsd - monthlyCost);
      summary.monthlyPercentUsed = (monthlyCost / limits.smaugMonthlyUsd) * 100;
    }

    return summary;
  }

  getAggregatedCostSummary(): AggregatedCostSummary {
    const apis: ApiName[] = ['anthropic', 'apify', 'smaug'];
    const byApi = apis.map((api) => this.getCostSummary(api));

    return {
      byApi,
      totalDailyCost: byApi.reduce((sum, s) => sum + s.dailyCost, 0),
      totalMonthlyCost: byApi.reduce((sum, s) => sum + s.monthlyCost, 0),
      timestamp: new Date().toISOString(),
    };
  }

  getBudgetSummary(): BudgetStatus[] {
    const limits = this.getBudgetLimits();
    return getBudgetSummary(limits);
  }

  getAllBudgetWarnings(): BudgetWarning[] {
    const apis: ApiName[] = ['anthropic', 'apify', 'smaug'];
    const allWarnings: BudgetWarning[] = [];
    for (const api of apis) {
      allWarnings.push(...this.checkBudgetWarnings(api));
    }
    return allWarnings;
  }

  getHighestWarning(): BudgetWarning | null {
    const warnings = this.getAllBudgetWarnings();
    if (warnings.length === 0) return null;
    return warnings.reduce((highest, current) =>
      current.percentUsed > highest.percentUsed ? current : highest
    );
  }

  getCostHistory(
    apiName: ApiName,
    options: {
      startDate?: string;
      endDate?: string;
      limit?: number;
    } = {}
  ): CostEntry[] {
    return listCostEntries({
      apiName,
      createdAfter: options.startDate,
      createdBefore: options.endDate,
      limit: options.limit ?? 100,
      orderBy: 'created_at',
      orderDir: 'desc',
    });
  }

  getTotalCost(apiName: ApiName, startDate: string, endDate?: string): number {
    return getTotalCostForPeriod(apiName, startDate, endDate);
  }

  getTotalTokens(apiName: ApiName, startDate: string, endDate?: string): number {
    return getTotalTokensForPeriod(apiName, startDate, endDate);
  }

  getWeeklyCost(apiName: ApiName): number {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    weekAgo.setUTCHours(0, 0, 0, 0);
    const startDate = weekAgo.toISOString().replace('T', ' ').replace('Z', '').slice(0, 19);
    return getTotalCostForPeriod(apiName, startDate);
  }

  getDailyCostBreakdown(apiName: ApiName, days: number = 7): { date: string; cost: number }[] {
    const breakdown: { date: string; cost: number }[] = [];
    const now = new Date();

    for (let i = 0; i < days; i++) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      date.setUTCHours(0, 0, 0, 0);

      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);

      const startDate = date.toISOString().replace('T', ' ').replace('Z', '').slice(0, 19);
      const endDate = nextDate.toISOString().replace('T', ' ').replace('Z', '').slice(0, 19);

      const cost = getTotalCostForPeriod(apiName, startDate, endDate);
      breakdown.push({
        date: date.toISOString().slice(0, 10),
        cost,
      });
    }

    return breakdown.reverse();
  }
}

let defaultTracker: CostTracker | null = null;

export function getCostTracker(): CostTracker {
  if (!defaultTracker) {
    defaultTracker = new CostTracker();
  }
  return defaultTracker;
}

export function resetCostTracker(): void {
  defaultTracker = null;
}

export function trackApiCost(
  apiName: ApiName,
  costUsd: number,
  tokensUsed?: number,
  modelId?: string
): CostTrackingResult {
  return getCostTracker().trackCost(apiName, costUsd, tokensUsed, modelId);
}

export function getModelCosts(startDate?: string, endDate?: string): ModelCostSummary[] {
  return getCostTracker().getModelCostSummary(startDate, endDate);
}

export function getDailyModelCosts(): ModelCostSummary[] {
  return getCostTracker().getDailyModelCosts();
}

export function getMonthlyModelCosts(): ModelCostSummary[] {
  return getCostTracker().getMonthlyModelCosts();
}

export function checkBudgetBeforeApiCall(apiName: ApiName, estimatedCost: number): BudgetStatus[] {
  return getCostTracker().checkBudgetBeforeOperation(apiName, estimatedCost);
}

export function isApiBudgetExceeded(apiName: ApiName, proposedCost: number = 0): boolean {
  return getCostTracker().isBudgetExceeded(apiName, proposedCost);
}

export function getApiCostSummary(apiName: ApiName): CostSummary {
  return getCostTracker().getCostSummary(apiName);
}

export function getAllCostSummaries(): AggregatedCostSummary {
  return getCostTracker().getAggregatedCostSummary();
}

export function formatCostForDisplay(costUsd: number): string {
  if (costUsd < 0.01) {
    return `$${costUsd.toFixed(4)}`;
  }
  if (costUsd < 1) {
    return `$${costUsd.toFixed(3)}`;
  }
  return `$${costUsd.toFixed(2)}`;
}

export function formatBudgetWarning(warning: BudgetWarning): string {
  const percentStr = (warning.percentUsed * 100).toFixed(1);
  return `${warning.apiName} ${warning.period} budget at ${percentStr}% (${formatCostForDisplay(warning.used)} / ${formatCostForDisplay(warning.limit)})`;
}

export function formatCostSummary(summary: CostSummary): string {
  const dailyLimitStr =
    summary.dailyLimit !== undefined && summary.dailyPercentUsed !== undefined
      ? ` / ${formatCostForDisplay(summary.dailyLimit)} (${summary.dailyPercentUsed.toFixed(1)}%)`
      : '';
  const monthlyLimitStr =
    summary.monthlyLimit !== undefined && summary.monthlyPercentUsed !== undefined
      ? ` / ${formatCostForDisplay(summary.monthlyLimit)} (${summary.monthlyPercentUsed.toFixed(1)}%)`
      : '';

  const lines: string[] = [
    `${summary.apiName.toUpperCase()} Cost Summary:`,
    `  Daily: ${formatCostForDisplay(summary.dailyCost)}${dailyLimitStr}`,
    `  Monthly: ${formatCostForDisplay(summary.monthlyCost)}${monthlyLimitStr}`,
  ];
  return lines.join('\n');
}

export type PeriodType = 'daily' | 'weekly' | 'monthly';

export interface PeriodCostSummary {
  period: PeriodType;
  startDate: string;
  endDate: string;
  totalCost: number;
  totalTokens: number;
  byApi: {
    apiName: ApiName;
    cost: number;
    tokens: number;
    percentOfTotal: number;
  }[];
  entryCount: number;
}

export interface CostTrend {
  period: PeriodType;
  current: number;
  previous: number;
  change: number;
  changePercent: number;
  trend: 'up' | 'down' | 'stable';
}

export interface PeriodCostHistory {
  period: PeriodType;
  summaries: PeriodCostSummary[];
}

function getStartOfWeek(): string {
  const now = new Date();
  const dayOfWeek = now.getUTCDay();
  const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  now.setUTCDate(now.getUTCDate() - diff);
  now.setUTCHours(0, 0, 0, 0);
  return now.toISOString().replace('T', ' ').replace('Z', '').slice(0, 19);
}

function formatDateForDb(date: Date): string {
  return date.toISOString().replace('T', ' ').replace('Z', '').slice(0, 19);
}

function getDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function getDailyCostSummary(date?: Date): PeriodCostSummary {
  const targetDate = date ?? new Date();
  const startDate = new Date(targetDate);
  startDate.setUTCHours(0, 0, 0, 0);
  const endDate = new Date(startDate);
  endDate.setUTCDate(endDate.getUTCDate() + 1);

  return buildPeriodSummary('daily', startDate, endDate);
}

export function getWeeklyCostSummary(weekStartDate?: Date): PeriodCostSummary {
  let startDate: Date;
  if (weekStartDate) {
    startDate = new Date(weekStartDate);
    startDate.setUTCHours(0, 0, 0, 0);
  } else {
    const startStr = getStartOfWeek();
    startDate = new Date(startStr.replace(' ', 'T') + 'Z');
  }
  const endDate = new Date(startDate);
  endDate.setUTCDate(endDate.getUTCDate() + 7);

  return buildPeriodSummary('weekly', startDate, endDate);
}

export function getMonthlyCostSummary(year?: number, month?: number): PeriodCostSummary {
  const now = new Date();
  const targetYear = year ?? now.getUTCFullYear();
  const targetMonth = month ?? now.getUTCMonth();

  const startDate = new Date(Date.UTC(targetYear, targetMonth, 1, 0, 0, 0, 0));
  const endDate = new Date(Date.UTC(targetYear, targetMonth + 1, 1, 0, 0, 0, 0));

  return buildPeriodSummary('monthly', startDate, endDate);
}

function buildPeriodSummary(period: PeriodType, startDate: Date, endDate: Date): PeriodCostSummary {
  const startStr = formatDateForDb(startDate);
  const endStr = formatDateForDb(endDate);
  const apis: ApiName[] = ['anthropic', 'apify', 'smaug'];

  let totalCost = 0;
  let totalTokens = 0;
  const byApi: PeriodCostSummary['byApi'] = [];

  for (const apiName of apis) {
    const cost = getTotalCostForPeriod(apiName, startStr, endStr);
    const tokens = getTotalTokensForPeriod(apiName, startStr, endStr);
    totalCost += cost;
    totalTokens += tokens;
    byApi.push({ apiName, cost, tokens, percentOfTotal: 0 });
  }

  for (const entry of byApi) {
    entry.percentOfTotal = totalCost > 0 ? (entry.cost / totalCost) * 100 : 0;
  }

  const entries = listCostEntries({
    createdAfter: startStr,
    createdBefore: endStr,
    limit: 1,
  });

  return {
    period,
    startDate: getDateOnly(startDate),
    endDate: getDateOnly(endDate),
    totalCost,
    totalTokens,
    byApi,
    entryCount: entries.length > 0 ? countEntriesInPeriod(startStr, endStr) : 0,
  };
}

function countEntriesInPeriod(startDate: string, endDate: string): number {
  const db = getDb();
  const stmt = db.prepare(
    `SELECT COUNT(*) as count FROM cost_tracking WHERE created_at >= ? AND created_at < ?`
  );
  const result = stmt.get(startDate, endDate) as { count: number };
  return result.count;
}

export function getCostTrend(period: PeriodType, apiName?: ApiName): CostTrend {
  const now = new Date();
  let current: number;
  let previous: number;

  if (period === 'daily') {
    const today = new Date(now);
    today.setUTCHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const dayBefore = new Date(yesterday);
    dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);

    current = getPeriodCost(formatDateForDb(yesterday), formatDateForDb(today), apiName);
    previous = getPeriodCost(formatDateForDb(dayBefore), formatDateForDb(yesterday), apiName);
  } else if (period === 'weekly') {
    const thisWeekStart = new Date(getStartOfWeek().replace(' ', 'T') + 'Z');
    const lastWeekStart = new Date(thisWeekStart);
    lastWeekStart.setUTCDate(lastWeekStart.getUTCDate() - 7);
    const twoWeeksAgoStart = new Date(lastWeekStart);
    twoWeeksAgoStart.setUTCDate(twoWeeksAgoStart.getUTCDate() - 7);

    current = getPeriodCost(
      formatDateForDb(lastWeekStart),
      formatDateForDb(thisWeekStart),
      apiName
    );
    previous = getPeriodCost(
      formatDateForDb(twoWeeksAgoStart),
      formatDateForDb(lastWeekStart),
      apiName
    );
  } else {
    const thisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const twoMonthsAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1));

    current = getPeriodCost(formatDateForDb(lastMonth), formatDateForDb(thisMonth), apiName);
    previous = getPeriodCost(formatDateForDb(twoMonthsAgo), formatDateForDb(lastMonth), apiName);
  }

  const change = current - previous;
  const changePercent = previous > 0 ? (change / previous) * 100 : current > 0 ? 100 : 0;

  let trend: 'up' | 'down' | 'stable';
  if (Math.abs(changePercent) < 5) {
    trend = 'stable';
  } else if (change > 0) {
    trend = 'up';
  } else {
    trend = 'down';
  }

  return { period, current, previous, change, changePercent, trend };
}

function getPeriodCost(startDate: string, endDate: string, apiName?: ApiName): number {
  if (apiName) {
    return getTotalCostForPeriod(apiName, startDate, endDate);
  }
  const apis: ApiName[] = ['anthropic', 'apify', 'smaug'];
  return apis.reduce((sum, api) => sum + getTotalCostForPeriod(api, startDate, endDate), 0);
}

export function getDailyCostHistory(days: number = 30, apiName?: ApiName): PeriodCostHistory {
  const summaries: PeriodCostSummary[] = [];
  const now = new Date();

  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now);
    date.setUTCDate(date.getUTCDate() - i);
    const summary = getDailyCostSummary(date);
    if (apiName) {
      const apiData = summary.byApi.find((a) => a.apiName === apiName);
      if (apiData) {
        summary.totalCost = apiData.cost;
        summary.totalTokens = apiData.tokens;
        summary.byApi = [{ ...apiData, percentOfTotal: 100 }];
      }
    }
    summaries.push(summary);
  }

  return { period: 'daily', summaries };
}

export function getWeeklyCostHistory(weeks: number = 12, apiName?: ApiName): PeriodCostHistory {
  const summaries: PeriodCostSummary[] = [];
  const startOfCurrentWeek = new Date(getStartOfWeek().replace(' ', 'T') + 'Z');

  for (let i = weeks - 1; i >= 0; i--) {
    const weekStart = new Date(startOfCurrentWeek);
    weekStart.setUTCDate(weekStart.getUTCDate() - i * 7);
    const summary = getWeeklyCostSummary(weekStart);
    if (apiName) {
      const apiData = summary.byApi.find((a) => a.apiName === apiName);
      if (apiData) {
        summary.totalCost = apiData.cost;
        summary.totalTokens = apiData.tokens;
        summary.byApi = [{ ...apiData, percentOfTotal: 100 }];
      }
    }
    summaries.push(summary);
  }

  return { period: 'weekly', summaries };
}

export function getMonthlyCostHistory(months: number = 12, apiName?: ApiName): PeriodCostHistory {
  const summaries: PeriodCostSummary[] = [];
  const now = new Date();

  for (let i = months - 1; i >= 0; i--) {
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() - i;
    const targetDate = new Date(Date.UTC(year, month, 1));
    const summary = getMonthlyCostSummary(targetDate.getUTCFullYear(), targetDate.getUTCMonth());
    if (apiName) {
      const apiData = summary.byApi.find((a) => a.apiName === apiName);
      if (apiData) {
        summary.totalCost = apiData.cost;
        summary.totalTokens = apiData.tokens;
        summary.byApi = [{ ...apiData, percentOfTotal: 100 }];
      }
    }
    summaries.push(summary);
  }

  return { period: 'monthly', summaries };
}

export interface AllPeriodSummaries {
  daily: PeriodCostSummary;
  weekly: PeriodCostSummary;
  monthly: PeriodCostSummary;
  trends: {
    daily: CostTrend;
    weekly: CostTrend;
    monthly: CostTrend;
  };
  generatedAt: string;
}

export function getAllPeriodSummaries(apiName?: ApiName): AllPeriodSummaries {
  const daily = getDailyCostSummary();
  const weekly = getWeeklyCostSummary();
  const monthly = getMonthlyCostSummary();

  if (apiName) {
    const filterByApi = (summary: PeriodCostSummary): void => {
      const apiData = summary.byApi.find((a) => a.apiName === apiName);
      if (apiData) {
        summary.totalCost = apiData.cost;
        summary.totalTokens = apiData.tokens;
        summary.byApi = [{ ...apiData, percentOfTotal: 100 }];
      }
    };
    filterByApi(daily);
    filterByApi(weekly);
    filterByApi(monthly);
  }

  return {
    daily,
    weekly,
    monthly,
    trends: {
      daily: getCostTrend('daily', apiName),
      weekly: getCostTrend('weekly', apiName),
      monthly: getCostTrend('monthly', apiName),
    },
    generatedAt: new Date().toISOString(),
  };
}

export function formatPeriodCostSummary(summary: PeriodCostSummary): string {
  const periodLabel =
    summary.period === 'daily' ? 'Day' : summary.period === 'weekly' ? 'Week' : 'Month';
  const lines: string[] = [
    `${periodLabel}: ${summary.startDate} to ${summary.endDate}`,
    `Total Cost: ${formatCostForDisplay(summary.totalCost)}`,
    `Total Tokens: ${summary.totalTokens.toLocaleString()}`,
    `Entries: ${summary.entryCount}`,
    '',
    'By API:',
  ];

  for (const api of summary.byApi) {
    if (api.cost > 0) {
      lines.push(
        `  ${api.apiName}: ${formatCostForDisplay(api.cost)} (${api.percentOfTotal.toFixed(1)}%)`
      );
    }
  }

  return lines.join('\n');
}

export function formatCostTrend(trend: CostTrend): string {
  const arrow = trend.trend === 'up' ? '↑' : trend.trend === 'down' ? '↓' : '→';
  const changeStr =
    trend.change >= 0
      ? `+${formatCostForDisplay(trend.change)}`
      : formatCostForDisplay(trend.change);
  const percentStr =
    trend.changePercent >= 0
      ? `+${trend.changePercent.toFixed(1)}%`
      : `${trend.changePercent.toFixed(1)}%`;

  return `${trend.period}: ${formatCostForDisplay(trend.current)} ${arrow} ${changeStr} (${percentStr})`;
}

export function formatAllPeriodSummaries(summaries: AllPeriodSummaries): string {
  const lines: string[] = [
    '=== Cost Summaries ===',
    '',
    '--- Daily ---',
    formatPeriodCostSummary(summaries.daily),
    '',
    '--- Weekly ---',
    formatPeriodCostSummary(summaries.weekly),
    '',
    '--- Monthly ---',
    formatPeriodCostSummary(summaries.monthly),
    '',
    '--- Trends (vs Previous Period) ---',
    formatCostTrend(summaries.trends.daily),
    formatCostTrend(summaries.trends.weekly),
    formatCostTrend(summaries.trends.monthly),
    '',
    `Generated: ${summaries.generatedAt}`,
  ];

  return lines.join('\n');
}

export function getAllBudgetWarnings(): BudgetWarning[] {
  return getCostTracker().getAllBudgetWarnings();
}

export function getHighestBudgetWarning(): BudgetWarning | null {
  return getCostTracker().getHighestWarning();
}

export function checkApiBudgetWarnings(apiName: ApiName): BudgetWarning[] {
  return getCostTracker().checkBudgetWarnings(apiName);
}

export type { ModelCostSummary };
