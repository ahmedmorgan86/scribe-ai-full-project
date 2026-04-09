'use client';

import { useState, useEffect, useCallback } from 'react';

interface PerformanceStats {
  totalTracked: number;
  totalLikes: number;
  totalRetweets: number;
  totalReplies: number;
  totalImpressions: number;
  avgEngagementRate: number;
  avgPerformanceScore: number;
}

interface TopPost {
  id: number;
  postId: number;
  content: string;
  likes: number;
  retweets: number;
  replies: number;
  impressions: number;
  performanceScore: number;
  tweetUrl: string | null;
}

interface StatsResponse {
  stats: PerformanceStats;
  topPosts: TopPost[];
}

interface PerformanceWidgetProps {
  pollInterval?: number;
}

export function PerformanceWidget({
  pollInterval = 60000,
}: PerformanceWidgetProps): React.ReactElement {
  const [data, setData] = useState<StatsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch('/api/performance/stats');
      if (!response.ok) throw new Error('Failed to fetch stats');
      const result = (await response.json()) as StatsResponse;
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch stats');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStats();
    const interval = setInterval(() => void fetchStats(), pollInterval);
    return () => clearInterval(interval);
  }, [fetchStats, pollInterval]);

  if (isLoading) {
    return (
      <div className="rounded-lg bg-gray-800 p-6">
        <h3 className="text-lg font-medium text-white mb-4">Post Performance</h3>
        <div className="text-sm text-gray-400">Loading...</div>
      </div>
    );
  }

  if (error !== null || data === null) {
    return (
      <div className="rounded-lg bg-gray-800 p-6">
        <h3 className="text-lg font-medium text-white mb-4">Post Performance</h3>
        <div className="text-sm text-gray-500">{error ?? 'No data available'}</div>
      </div>
    );
  }

  const { stats, topPosts } = data;

  // Format large numbers
  const formatNumber = (num: number): string => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  return (
    <div className="rounded-lg bg-gray-800 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-medium text-white">Post Performance</h3>
        {stats.totalTracked > 0 && (
          <span className="text-xs px-2 py-1 rounded bg-blue-500/20 text-blue-400">
            {stats.totalTracked} tracked
          </span>
        )}
      </div>

      {stats.totalTracked === 0 ? (
        <div className="text-center py-6">
          <p className="text-sm text-gray-400 mb-2">No posts tracked yet</p>
          <p className="text-xs text-gray-500">
            Track your posted tweets to see performance metrics
          </p>
        </div>
      ) : (
        <>
          {/* Stats Grid */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="p-3 rounded bg-gray-900 border border-gray-700">
              <span className="text-xs text-gray-500 block">Total Likes</span>
              <span className="text-lg font-medium text-red-400">
                {formatNumber(stats.totalLikes)}
              </span>
            </div>
            <div className="p-3 rounded bg-gray-900 border border-gray-700">
              <span className="text-xs text-gray-500 block">Total Retweets</span>
              <span className="text-lg font-medium text-green-400">
                {formatNumber(stats.totalRetweets)}
              </span>
            </div>
            <div className="p-3 rounded bg-gray-900 border border-gray-700">
              <span className="text-xs text-gray-500 block">Avg Engagement</span>
              <span className="text-lg font-medium text-blue-400">
                {stats.avgEngagementRate.toFixed(2)}%
              </span>
            </div>
            <div className="p-3 rounded bg-gray-900 border border-gray-700">
              <span className="text-xs text-gray-500 block">Impressions</span>
              <span className="text-lg font-medium text-gray-200">
                {formatNumber(stats.totalImpressions)}
              </span>
            </div>
          </div>

          {/* Top Posts */}
          {topPosts.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-gray-300 mb-2">Top Performers</h4>
              <div className="space-y-2">
                {topPosts.slice(0, 3).map((post) => (
                  <div key={post.id} className="p-2 rounded bg-gray-900 border border-gray-700">
                    <p className="text-xs text-gray-400 truncate mb-1">{post.content}...</p>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-red-400">❤️ {post.likes}</span>
                      <span className="text-green-400">🔁 {post.retweets}</span>
                      <span className="text-blue-400">💬 {post.replies}</span>
                      {post.tweetUrl !== null && (
                        <a
                          href={post.tweetUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-gray-500 hover:text-gray-300 ml-auto"
                        >
                          View →
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default PerformanceWidget;
