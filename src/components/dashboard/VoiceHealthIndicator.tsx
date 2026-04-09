'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';

export interface VoiceHealthData {
  status: 'healthy' | 'warning' | 'critical' | 'unknown' | 'no_data';
  score: number | null;
  driftPercentage: number | null;
  threshold: number;
  issues: string[];
  postsWithSignatures: number;
  totalApprovedPosts: number;
}

interface VoiceHealthIndicatorProps {
  initialData?: VoiceHealthData;
  pollInterval?: number;
  compact?: boolean;
}

const STATUS_CONFIG: Record<
  string,
  { color: string; bgColor: string; ringColor: string; label: string }
> = {
  healthy: {
    color: 'text-green-400',
    bgColor: 'bg-green-500',
    ringColor: 'ring-green-500/30',
    label: 'Voice Consistent',
  },
  warning: {
    color: 'text-yellow-400',
    bgColor: 'bg-yellow-500',
    ringColor: 'ring-yellow-500/30',
    label: 'Minor Drift',
  },
  critical: {
    color: 'text-red-400',
    bgColor: 'bg-red-500',
    ringColor: 'ring-red-500/30',
    label: 'Significant Drift',
  },
  unknown: {
    color: 'text-gray-400',
    bgColor: 'bg-gray-500',
    ringColor: 'ring-gray-500/30',
    label: 'Unable to Analyze',
  },
  no_data: {
    color: 'text-gray-400',
    bgColor: 'bg-gray-600',
    ringColor: 'ring-gray-600/30',
    label: 'No Data',
  },
};

function getScoreColor(score: number): string {
  if (score >= 85) return 'text-green-400';
  if (score >= 70) return 'text-yellow-400';
  return 'text-red-400';
}

export function VoiceHealthIndicator({
  initialData,
  pollInterval = 60000,
  compact = false,
}: VoiceHealthIndicatorProps): React.ReactElement {
  const [data, setData] = useState<VoiceHealthData | null>(initialData ?? null);
  const [isLoading, setIsLoading] = useState(!initialData);
  const [error, setError] = useState<Error | null>(null);

  const isMountedRef = useRef(true);

  const fetchData = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch('/api/analytics/stylometric');

      if (!isMountedRef.current) return;

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = (await response.json()) as {
        voiceHealth: {
          status: VoiceHealthData['status'];
          score: number;
          driftPercentage: number;
          threshold: number;
          issues: string[];
        };
        postsWithSignatures: number;
        totalApprovedPosts: number;
      };

      if (!isMountedRef.current) return;

      setData({
        status: result.voiceHealth.status,
        score: result.voiceHealth.score,
        driftPercentage: result.voiceHealth.driftPercentage,
        threshold: result.voiceHealth.threshold,
        issues: result.voiceHealth.issues,
        postsWithSignatures: result.postsWithSignatures,
        totalApprovedPosts: result.totalApprovedPosts,
      });
      setError(null);
    } catch (err) {
      if (!isMountedRef.current) return;
      setError(err instanceof Error ? err : new Error('Failed to fetch voice health'));
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    return (): void => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!initialData) {
      void fetchData();
    }

    const interval = setInterval(() => {
      void fetchData();
    }, pollInterval);

    return (): void => clearInterval(interval);
  }, [fetchData, initialData, pollInterval]);

  if (isLoading) {
    return (
      <div className="animate-pulse">
        <div className={compact ? 'h-12 bg-gray-700 rounded-lg' : 'h-32 bg-gray-700 rounded-lg'} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg bg-red-900/20 border border-red-500/50 p-3">
        <p className="text-red-400 text-sm">Failed to load voice health: {error.message}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-lg bg-gray-800/50 border border-gray-700 p-4 text-center">
        <p className="text-gray-400 text-sm">No voice data available</p>
        <p className="text-gray-500 text-xs mt-1">
          Approve posts with stylometric signatures to see voice health
        </p>
      </div>
    );
  }

  if (compact) {
    return <CompactView data={data} />;
  }

  return <FullView data={data} />;
}

function CompactView({ data }: { data: VoiceHealthData }): React.ReactElement {
  const config = STATUS_CONFIG[data.status] ?? STATUS_CONFIG.unknown;
  const hasData = data.score !== null;

  return (
    <div className="flex items-center gap-4 p-3 rounded-lg bg-gray-800/50 border border-gray-700">
      <div
        className={`w-10 h-10 rounded-full ${config.bgColor} flex items-center justify-center ring-4 ${config.ringColor}`}
      >
        <span className="text-sm font-bold text-white">{hasData ? `${data.score}%` : 'N/A'}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-medium ${config.color}`}>{config.label}</span>
          {hasData &&
            data.status !== 'healthy' &&
            data.status !== 'unknown' &&
            data.driftPercentage !== null && (
              <span className="text-xs text-gray-500">
                {(data.driftPercentage * 100).toFixed(0)}% drift
              </span>
            )}
        </div>
        <p className="text-xs text-gray-500 truncate">
          {hasData
            ? `Based on ${data.postsWithSignatures} of ${data.totalApprovedPosts} posts`
            : 'Approve posts to see voice health'}
        </p>
      </div>
      {data.issues.length > 0 && data.status !== 'no_data' && (
        <span
          className="text-yellow-500 text-xs px-2 py-1 rounded-full bg-yellow-500/10"
          title={data.issues.join(', ')}
        >
          {data.issues.length} issue{data.issues.length > 1 ? 's' : ''}
        </span>
      )}
    </div>
  );
}

function FullView({ data }: { data: VoiceHealthData }): React.ReactElement {
  const config = STATUS_CONFIG[data.status] ?? STATUS_CONFIG.unknown;
  const hasData = data.score !== null;

  return (
    <div className="rounded-lg bg-gray-800/50 border border-gray-700 p-4">
      <div className="flex items-start gap-4">
        <div
          className={`w-16 h-16 rounded-full ${config.bgColor} flex items-center justify-center ring-4 ${config.ringColor} flex-shrink-0`}
        >
          <span
            className={`text-xl font-bold text-white ${hasData && data.score !== null ? getScoreColor(data.score) : 'text-gray-300'}`}
          >
            {hasData ? `${data.score}%` : 'N/A'}
          </span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-lg font-medium ${config.color}`}>{config.label}</span>
          </div>

          {hasData && data.driftPercentage !== null ? (
            <div className="flex items-center gap-4 text-xs text-gray-500 mb-3">
              <span>
                Drift:{' '}
                <span className="text-gray-300">{(data.driftPercentage * 100).toFixed(1)}%</span>
                <span className="text-gray-600 ml-1">
                  (threshold: {(data.threshold * 100).toFixed(0)}%)
                </span>
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-4 text-xs text-gray-500 mb-3">
              <span>
                Drift: <span className="text-gray-400">N/A</span>
              </span>
            </div>
          )}

          {data.issues.length > 0 && data.status !== 'no_data' && (
            <div className="space-y-1">
              {data.issues.slice(0, 3).map((issue, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <span className="text-yellow-500 mt-0.5">•</span>
                  <span className="text-gray-400">{issue}</span>
                </div>
              ))}
              {data.issues.length > 3 && (
                <p className="text-xs text-gray-500 pl-4">
                  +{data.issues.length - 3} more issue{data.issues.length - 3 > 1 ? 's' : ''}
                </p>
              )}
            </div>
          )}

          {data.status === 'no_data' && (
            <p className="text-xs text-gray-400">
              Approve posts with stylometric signatures to see voice health metrics
            </p>
          )}

          {data.issues.length === 0 && data.status === 'healthy' && (
            <p className="text-xs text-green-400">Voice consistency is excellent</p>
          )}
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-gray-700 flex justify-between text-xs text-gray-500">
        <span>
          Posts analyzed: <span className="text-gray-300">{data.postsWithSignatures}</span> of{' '}
          {data.totalApprovedPosts}
        </span>
        <a href="/analytics" className="text-blue-400 hover:text-blue-300 transition-colors">
          View details →
        </a>
      </div>
    </div>
  );
}

export default VoiceHealthIndicator;
