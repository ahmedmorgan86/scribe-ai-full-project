'use client';

import { ApiName } from '@/types';

export interface CostWidgetData {
  byApi: ApiCostData[];
  totalDailyCost: number;
  totalMonthlyCost: number;
  timestamp: string;
}

export interface ApiCostData {
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

interface CostWidgetProps {
  data: CostWidgetData;
}

export function CostWidget({ data }: CostWidgetProps): React.ReactElement {
  return (
    <div className="rounded-lg bg-gray-800 p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white">API Costs</h3>
        <span className="text-xs text-gray-500">
          {new Date(data.timestamp).toLocaleTimeString()}
        </span>
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4 pb-4 border-b border-gray-700">
          <TotalCostCard label="Today" value={data.totalDailyCost} />
          <TotalCostCard label="This Month" value={data.totalMonthlyCost} />
        </div>

        <div className="space-y-3">
          {data.byApi.map((api) => (
            <ApiCostRow key={api.apiName} data={api} />
          ))}
        </div>
      </div>
    </div>
  );
}

interface TotalCostCardProps {
  label: string;
  value: number;
}

function TotalCostCard({ label, value }: TotalCostCardProps): React.ReactElement {
  return (
    <div className="text-center">
      <div className="text-xs text-gray-400 mb-1">{label}</div>
      <div className="text-xl font-bold text-white">{formatCost(value)}</div>
    </div>
  );
}

interface ApiCostRowProps {
  data: ApiCostData;
}

function ApiCostRow({ data }: ApiCostRowProps): React.ReactElement {
  const hasMonthlyLimit = data.monthlyLimit !== undefined && data.monthlyPercentUsed !== undefined;
  const hasDailyLimit = data.dailyLimit !== undefined && data.dailyPercentUsed !== undefined;
  const warningLevel = getWarningLevel(data.monthlyPercentUsed ?? 0);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-300 uppercase">{data.apiName}</span>
        <div className="flex items-center space-x-4 text-xs text-gray-400">
          <span>Today: {formatCost(data.dailyCost)}</span>
          <span>Month: {formatCost(data.monthlyCost)}</span>
        </div>
      </div>

      {hasMonthlyLimit &&
        data.monthlyLimit !== undefined &&
        data.monthlyPercentUsed !== undefined && (
          <BudgetBar
            label="Monthly"
            used={data.monthlyCost}
            limit={data.monthlyLimit}
            percentUsed={data.monthlyPercentUsed}
            warningLevel={warningLevel}
          />
        )}

      {hasDailyLimit && data.dailyLimit !== undefined && data.dailyPercentUsed !== undefined && (
        <BudgetBar
          label="Daily"
          used={data.dailyCost}
          limit={data.dailyLimit}
          percentUsed={data.dailyPercentUsed}
          warningLevel={getWarningLevel(data.dailyPercentUsed)}
        />
      )}

      {!hasMonthlyLimit && !hasDailyLimit && (
        <div className="text-xs text-gray-500 italic">No budget limits configured</div>
      )}
    </div>
  );
}

type WarningLevel = 'safe' | 'low' | 'medium' | 'high' | 'critical';

interface BudgetBarProps {
  label: string;
  used: number;
  limit: number;
  percentUsed: number;
  warningLevel: WarningLevel;
}

function BudgetBar({
  label,
  used,
  limit,
  percentUsed,
  warningLevel,
}: BudgetBarProps): React.ReactElement {
  const barColor = getBarColor(warningLevel);
  const cappedPercent = Math.min(percentUsed, 100);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-500">{label}</span>
        <span className={getTextColor(warningLevel)}>
          {formatCost(used)} / {formatCost(limit)} ({Math.round(percentUsed)}%)
        </span>
      </div>
      <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${barColor}`}
          style={{ width: `${cappedPercent}%` }}
        />
      </div>
    </div>
  );
}

function getWarningLevel(percentUsed: number): WarningLevel {
  if (percentUsed >= 100) return 'critical';
  if (percentUsed >= 95) return 'high';
  if (percentUsed >= 80) return 'medium';
  if (percentUsed >= 50) return 'low';
  return 'safe';
}

function getBarColor(level: WarningLevel): string {
  switch (level) {
    case 'critical':
      return 'bg-red-500';
    case 'high':
      return 'bg-orange-500';
    case 'medium':
      return 'bg-yellow-500';
    case 'low':
      return 'bg-blue-500';
    case 'safe':
      return 'bg-green-500';
  }
}

function getTextColor(level: WarningLevel): string {
  switch (level) {
    case 'critical':
      return 'text-red-400';
    case 'high':
      return 'text-orange-400';
    case 'medium':
      return 'text-yellow-400';
    case 'low':
      return 'text-blue-400';
    case 'safe':
      return 'text-green-400';
  }
}

function formatCost(costUsd: number): string {
  if (costUsd < 0.01) {
    return `$${costUsd.toFixed(4)}`;
  }
  if (costUsd < 1) {
    return `$${costUsd.toFixed(3)}`;
  }
  return `$${costUsd.toFixed(2)}`;
}

export function createEmptyCostWidgetData(): CostWidgetData {
  return {
    byApi: [
      createEmptyApiCostData('anthropic'),
      createEmptyApiCostData('apify'),
      createEmptyApiCostData('smaug'),
    ],
    totalDailyCost: 0,
    totalMonthlyCost: 0,
    timestamp: new Date().toISOString(),
  };
}

function createEmptyApiCostData(apiName: ApiName): ApiCostData {
  return {
    apiName,
    dailyCost: 0,
    monthlyCost: 0,
  };
}
