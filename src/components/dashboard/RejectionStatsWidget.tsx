'use client';

import { useState, useEffect, useCallback } from 'react';

interface RejectionAnalytics {
  total: number;
  topReasons: Array<{
    reason: string;
    label: string;
    category: string;
    count: number;
    percentage: number;
  }>;
}

interface RejectionStatsWidgetProps {
  pollInterval?: number;
}

const CATEGORY_COLORS: Record<string, string> = {
  voice: 'text-blue-400',
  content: 'text-purple-400',
  style: 'text-amber-400',
  other: 'text-gray-400',
};

export function RejectionStatsWidget({
  pollInterval = 60000,
}: RejectionStatsWidgetProps): React.ReactElement {
  const [data, setData] = useState<RejectionAnalytics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch('/api/analytics/rejections');
      if (!response.ok) throw new Error('Failed to fetch');
      const result = (await response.json()) as RejectionAnalytics;
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch rejection stats');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
    const interval = setInterval(() => void fetchData(), pollInterval);
    return () => clearInterval(interval);
  }, [fetchData, pollInterval]);

  if (isLoading) {
    return (
      <div className="rounded-lg bg-gray-800 p-6">
        <h3 className="text-lg font-medium text-white mb-4">Rejection Patterns</h3>
        <div className="text-sm text-gray-400">Loading...</div>
      </div>
    );
  }

  if (error !== null || !data) {
    return (
      <div className="rounded-lg bg-gray-800 p-6">
        <h3 className="text-lg font-medium text-white mb-4">Rejection Patterns</h3>
        <div className="text-sm text-red-400">{error ?? 'Failed to load'}</div>
      </div>
    );
  }

  if (data.total === 0) {
    return (
      <div className="rounded-lg bg-gray-800 p-6">
        <h3 className="text-lg font-medium text-white mb-4">Rejection Patterns</h3>
        <div className="text-sm text-gray-500">No rejections recorded yet</div>
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-gray-800 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-medium text-white">Rejection Patterns</h3>
        <span className="text-sm text-gray-500">{data.total} total</span>
      </div>

      <div className="space-y-3">
        {data.topReasons.map((reason, index) => (
          <div key={reason.reason} className="flex items-center gap-3">
            <span className="text-xs text-gray-500 w-4">{index + 1}.</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-gray-200 truncate">{reason.label}</span>
                <span className="text-xs text-gray-400">{reason.count}</span>
              </div>
              <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className={`h-full ${
                    reason.category === 'voice'
                      ? 'bg-blue-500'
                      : reason.category === 'content'
                        ? 'bg-purple-500'
                        : reason.category === 'style'
                          ? 'bg-amber-500'
                          : 'bg-gray-500'
                  } transition-all`}
                  style={{ width: `${reason.percentage}%` }}
                />
              </div>
            </div>
            <span className={`text-xs ${CATEGORY_COLORS[reason.category] ?? 'text-gray-400'}`}>
              {reason.percentage}%
            </span>
          </div>
        ))}
      </div>

      {/* Category Legend */}
      <div className="flex flex-wrap gap-3 mt-4 pt-4 border-t border-gray-700">
        {['voice', 'content', 'style'].map((cat) => (
          <div key={cat} className="flex items-center gap-1.5">
            <div
              className={`w-2 h-2 rounded-full ${
                cat === 'voice'
                  ? 'bg-blue-500'
                  : cat === 'content'
                    ? 'bg-purple-500'
                    : 'bg-amber-500'
              }`}
            />
            <span className="text-xs text-gray-500 capitalize">{cat}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default RejectionStatsWidget;
