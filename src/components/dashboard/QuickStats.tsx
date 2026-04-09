'use client';

export interface QuickStatsData {
  postsToday: number;
  approvalRate7d: number;
  approvalRate30d: number;
  trend: 'up' | 'down' | 'stable';
  trendDelta: number;
}

interface QuickStatsProps {
  stats: QuickStatsData;
}

export function QuickStats({ stats }: QuickStatsProps): React.ReactElement {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCard label="Posts Today" value={stats.postsToday} sublabel="posts created" />
      <StatCard
        label="7-Day Approval Rate"
        value={formatPercent(stats.approvalRate7d)}
        sublabel={getTrendLabel(stats.trend, stats.trendDelta)}
        trend={stats.trend}
      />
      <StatCard
        label="30-Day Approval Rate"
        value={formatPercent(stats.approvalRate30d)}
        sublabel="monthly average"
      />
      <TrendCard trend={stats.trend} delta={stats.trendDelta} />
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string | number;
  sublabel: string;
  trend?: 'up' | 'down' | 'stable';
}

function StatCard({ label, value, sublabel, trend }: StatCardProps): React.ReactElement {
  const trendColor =
    trend === 'up' ? 'text-green-400' : trend === 'down' ? 'text-red-400' : 'text-gray-400';

  return (
    <div className="rounded-lg bg-gray-800 p-4">
      <div className="text-sm text-gray-400 mb-1">{label}</div>
      <div className="text-2xl font-bold text-white">{value}</div>
      <div className={`text-xs mt-1 ${trend ? trendColor : 'text-gray-500'}`}>{sublabel}</div>
    </div>
  );
}

interface TrendCardProps {
  trend: 'up' | 'down' | 'stable';
  delta: number;
}

function TrendCard({ trend, delta }: TrendCardProps): React.ReactElement {
  const config = getTrendConfig(trend);
  const absDelta = Math.abs(delta);

  return (
    <div className={`rounded-lg ${config.bgColor} p-4 border ${config.borderColor}`}>
      <div className="text-sm text-gray-400 mb-1">Trend</div>
      <div className="flex items-center space-x-2">
        <span className={`text-2xl ${config.textColor}`}>{config.icon}</span>
        <span className={`text-2xl font-bold ${config.textColor}`}>
          {absDelta > 0 ? `${absDelta}%` : 'Stable'}
        </span>
      </div>
      <div className={`text-xs mt-1 ${config.textColor}`}>{config.label}</div>
    </div>
  );
}

interface TrendConfig {
  icon: string;
  label: string;
  textColor: string;
  bgColor: string;
  borderColor: string;
}

function getTrendConfig(trend: 'up' | 'down' | 'stable'): TrendConfig {
  switch (trend) {
    case 'up':
      return {
        icon: '↑',
        label: 'Improving from last period',
        textColor: 'text-green-400',
        bgColor: 'bg-green-900/20',
        borderColor: 'border-green-700',
      };
    case 'down':
      return {
        icon: '↓',
        label: 'Declining from last period',
        textColor: 'text-red-400',
        bgColor: 'bg-red-900/20',
        borderColor: 'border-red-700',
      };
    case 'stable':
      return {
        icon: '→',
        label: 'Consistent with last period',
        textColor: 'text-gray-400',
        bgColor: 'bg-gray-800',
        borderColor: 'border-gray-700',
      };
  }
}

function getTrendLabel(trend: 'up' | 'down' | 'stable', delta: number): string {
  const absDelta = Math.abs(delta);
  switch (trend) {
    case 'up':
      return `↑ ${absDelta}% vs last week`;
    case 'down':
      return `↓ ${absDelta}% vs last week`;
    case 'stable':
      return '→ stable vs last week';
  }
}

function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

export function createEmptyQuickStats(): QuickStatsData {
  return {
    postsToday: 0,
    approvalRate7d: 0,
    approvalRate30d: 0,
    trend: 'stable',
    trendDelta: 0,
  };
}
