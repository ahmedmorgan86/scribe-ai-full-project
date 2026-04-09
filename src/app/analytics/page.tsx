'use client';

import { useState, useEffect, useCallback } from 'react';
import type { StylometricAnalyticsResponse } from '@/app/api/analytics/stylometric/route';
import type { HumanizerAnalyticsResponse } from '@/app/api/analytics/humanizer/route';

interface SectionProps {
  title: string;
  description: string;
  children: React.ReactNode;
}

function Section({ title, description, children }: SectionProps): React.ReactElement {
  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800 p-6">
      <h2 className="text-lg font-medium text-white mb-1">{title}</h2>
      <p className="text-sm text-gray-400 mb-4">{description}</p>
      {children}
    </div>
  );
}

function getHealthColor(status: string): string {
  switch (status) {
    case 'healthy':
      return 'text-green-400';
    case 'warning':
      return 'text-yellow-400';
    case 'critical':
      return 'text-red-400';
    default:
      return 'text-gray-400';
  }
}

function getHealthBgColor(status: string): string {
  switch (status) {
    case 'healthy':
      return 'bg-green-500';
    case 'warning':
      return 'bg-yellow-500';
    case 'critical':
      return 'bg-red-500';
    default:
      return 'bg-gray-500';
  }
}

function getHealthLabel(status: string): string {
  switch (status) {
    case 'healthy':
      return 'Voice Consistent';
    case 'warning':
      return 'Minor Drift Detected';
    case 'critical':
      return 'Significant Drift';
    case 'no_data':
      return 'No Data';
    default:
      return 'Unable to Analyze';
  }
}

function getDiffColor(diff: number | null): string {
  if (diff === null) return 'text-gray-500';
  if (Math.abs(diff) < 0.05) return 'text-gray-400';
  return diff > 0 ? 'text-amber-400' : 'text-cyan-400';
}

function formatDiff(diff: number | null): string {
  if (diff === null) return '--';
  const sign = diff > 0 ? '+' : '';
  return `${sign}${diff.toFixed(3)}`;
}

interface TrendChartProps {
  data: { date: string; value: number }[];
  label: string;
  color: string;
  unit?: string;
}

function TrendChart({ data, label, color, unit = '' }: TrendChartProps): React.ReactElement {
  if (data.length === 0) {
    return (
      <div className="h-24 flex items-center justify-center text-gray-500 text-sm">
        No data available
      </div>
    );
  }

  const values = data.map((d) => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const latestValue = values[values.length - 1];
  const avgValue = values.reduce((a, b) => a + b, 0) / values.length;

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-baseline">
        <span className="text-sm text-gray-400">{label}</span>
        <div className="text-right">
          <span className={`text-lg font-semibold ${color}`}>
            {latestValue.toFixed(2)}
            {unit}
          </span>
          <span className="text-xs text-gray-500 ml-2">avg: {avgValue.toFixed(2)}</span>
        </div>
      </div>
      <div className="h-16 flex items-end gap-0.5">
        {data.slice(-14).map((point, i) => {
          const height = ((point.value - min) / range) * 100;
          return (
            <div
              key={i}
              className="flex-1 bg-gray-700 rounded-t relative group"
              style={{ height: `${Math.max(height, 5)}%` }}
            >
              <div
                className={`absolute inset-0 rounded-t ${color.replace('text-', 'bg-')} opacity-60`}
              />
              <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 px-1.5 py-0.5 bg-gray-900 rounded text-xs text-gray-300 opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none z-10">
                {point.date}: {point.value.toFixed(3)}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-xs text-gray-600">
        <span>{data.slice(-14)[0]?.date ?? ''}</span>
        <span>{data[data.length - 1]?.date ?? ''}</span>
      </div>
    </div>
  );
}

interface MetricCardProps {
  label: string;
  current: number | null;
  baseline: number | null;
  diff: number | null;
  unit?: string;
  description?: string;
}

function MetricCard({
  label,
  current,
  baseline,
  diff,
  unit = '',
  description,
}: MetricCardProps): React.ReactElement {
  return (
    <div className="p-4 rounded-lg bg-gray-900 border border-gray-700">
      <div className="flex justify-between items-start mb-2">
        <span className="text-sm text-gray-400">{label}</span>
        <span className={`text-xs ${getDiffColor(diff)}`}>{formatDiff(diff)}</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold text-white">
          {current !== null ? current.toFixed(2) : '--'}
          {unit}
        </span>
        {baseline !== null && (
          <span className="text-xs text-gray-500">baseline: {baseline.toFixed(2)}</span>
        )}
      </div>
      {description && <p className="text-xs text-gray-600 mt-1">{description}</p>}
    </div>
  );
}

function getSeverityColor(severity: 'low' | 'medium' | 'high'): string {
  switch (severity) {
    case 'high':
      return 'text-red-400';
    case 'medium':
      return 'text-yellow-400';
    case 'low':
      return 'text-blue-400';
  }
}

export default function AnalyticsPage(): React.ReactElement {
  const [data, setData] = useState<StylometricAnalyticsResponse | null>(null);
  const [humanizerData, setHumanizerData] = useState<HumanizerAnalyticsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (): Promise<void> => {
    try {
      setIsLoading(true);
      const [stylometricRes, humanizerRes] = await Promise.all([
        fetch('/api/analytics/stylometric'),
        fetch('/api/analytics/humanizer'),
      ]);
      if (!stylometricRes.ok) {
        throw new Error(`Stylometric: HTTP ${stylometricRes.status}`);
      }
      const stylometricResult = (await stylometricRes.json()) as StylometricAnalyticsResponse;
      setData(stylometricResult);

      if (humanizerRes.ok) {
        const humanizerResult = (await humanizerRes.json()) as HumanizerAnalyticsResponse;
        setHumanizerData(humanizerResult);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch analytics');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">Loading analytics...</div>
      </div>
    );
  }

  if (error !== null || data === null) {
    return (
      <div className="rounded-lg bg-red-900/20 border border-red-500/50 p-4">
        <p className="text-red-400">Failed to load analytics: {error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Voice Analytics</h1>
          <p className="text-sm text-gray-400 mt-1">
            Stylometric analysis and voice consistency metrics
          </p>
        </div>
        <button
          onClick={() => void fetchData()}
          className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-600 text-gray-200 hover:bg-gray-700"
        >
          Refresh
        </button>
      </div>

      <Section
        title="Voice Health"
        description="Overall voice consistency based on stylometric drift"
      >
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-4">
            <div
              className={`w-16 h-16 rounded-full ${getHealthBgColor(data.voiceHealth.status)} flex items-center justify-center`}
            >
              <span className="text-2xl font-bold text-white">
                {data.voiceHealth.score !== null ? `${data.voiceHealth.score}%` : 'N/A'}
              </span>
            </div>
            <div>
              <p className={`text-lg font-medium ${getHealthColor(data.voiceHealth.status)}`}>
                {getHealthLabel(data.voiceHealth.status)}
              </p>
              <p className="text-sm text-gray-500">
                Drift:{' '}
                {data.voiceHealth.driftPercentage !== null
                  ? `${(data.voiceHealth.driftPercentage * 100).toFixed(1)}%`
                  : 'N/A'}{' '}
                (threshold: {(data.voiceHealth.threshold * 100).toFixed(0)}%)
              </p>
            </div>
          </div>

          <div className="flex-1 border-l border-gray-700 pl-6 ml-6">
            <p className="text-xs text-gray-500 mb-2">
              Based on {data.current.sampleCount} recent posts
            </p>
            {data.voiceHealth.issues.length > 0 ? (
              <ul className="space-y-1">
                {data.voiceHealth.issues.map((issue, i) => (
                  <li key={i} className="text-sm text-gray-400 flex items-start gap-2">
                    <span className="text-yellow-500 mt-0.5">•</span>
                    {issue}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-green-400">No issues detected</p>
            )}
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-gray-700 flex gap-4 text-sm">
          <span className="text-gray-500">
            Posts with signatures:
            <span className="text-gray-300 ml-1">{data.postsWithSignatures}</span>
          </span>
          <span className="text-gray-500">
            Total approved: <span className="text-gray-300">{data.totalApprovedPosts}</span>
          </span>
        </div>
      </Section>

      {humanizerData && (
        <Section
          title="Top AI Patterns in Your Content"
          description="Most frequently detected AI writing patterns from the humanizer"
        >
          {humanizerData.topPatterns.length > 0 ? (
            <>
              <div className="space-y-2">
                {humanizerData.topPatterns.slice(0, 5).map((pattern, i) => (
                  <div
                    key={pattern.patternType}
                    className="flex items-center gap-4 p-3 rounded bg-gray-900 border border-gray-700"
                  >
                    <span className="text-lg font-bold text-gray-500 w-6">{i + 1}</span>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-white font-medium">{pattern.patternName}</span>
                        <span
                          className={`text-xs px-1.5 py-0.5 rounded ${getSeverityColor(pattern.severity)} bg-gray-800`}
                        >
                          {pattern.severity}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {pattern.postsAffected} posts affected
                      </p>
                    </div>
                    <div className="text-right">
                      <span className="text-2xl font-semibold text-orange-400">
                        {pattern.count}
                      </span>
                      <p className="text-xs text-gray-500">detections</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 pt-4 border-t border-gray-700 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div className="p-3 rounded bg-gray-900 border border-gray-700">
                  <p className="text-xs text-gray-500">Posts Analyzed</p>
                  <p className="text-lg font-semibold text-white">{humanizerData.postsAnalyzed}</p>
                </div>
                <div className="p-3 rounded bg-gray-900 border border-gray-700">
                  <p className="text-xs text-gray-500">Posts with Patterns</p>
                  <p className="text-lg font-semibold text-orange-400">
                    {humanizerData.postsWithPatterns}
                  </p>
                </div>
                <div className="p-3 rounded bg-gray-900 border border-gray-700">
                  <p className="text-xs text-gray-500">Total Detections</p>
                  <p className="text-lg font-semibold text-white">
                    {humanizerData.totalPatternsDetected}
                  </p>
                </div>
                <div className="p-3 rounded bg-gray-900 border border-gray-700">
                  <p className="text-xs text-gray-500">Avg per Post</p>
                  <p className="text-lg font-semibold text-white">
                    {humanizerData.avgPatternsPerPost}
                  </p>
                </div>
              </div>
            </>
          ) : (
            <p className="text-gray-500">No AI patterns detected in recent content</p>
          )}
        </Section>
      )}

      <Section
        title="Current Metrics vs Baseline"
        description="How recent posts compare to your established voice baseline"
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <MetricCard
            label="Avg Sentence Length"
            current={data.baseline.sentenceLength.current}
            baseline={data.baseline.sentenceLength.baseline}
            diff={data.baseline.sentenceLength.diff}
            unit=" words"
            description="Average words per sentence"
          />
          <MetricCard
            label="Vocabulary Richness"
            current={data.baseline.vocabularyRichness.current}
            baseline={data.baseline.vocabularyRichness.baseline}
            diff={data.baseline.vocabularyRichness.diff}
            description="Type-token ratio (unique/total words)"
          />
          <MetricCard
            label="Period Rate"
            current={data.baseline.punctuationPeriod.current}
            baseline={data.baseline.punctuationPeriod.baseline}
            diff={data.baseline.punctuationPeriod.diff}
            description="Proportion of punctuation that is periods"
          />
        </div>
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Section
          title="Sentence Length Trend"
          description="Rolling average sentence length over time"
        >
          <TrendChart
            data={data.trends.sentenceLength}
            label="Words per sentence"
            color="text-cyan-400"
            unit=" words"
          />
        </Section>

        <Section
          title="Vocabulary Richness Trend"
          description="Type-token ratio (vocabulary diversity)"
        >
          <TrendChart
            data={data.trends.vocabularyRichness}
            label="Type-token ratio"
            color="text-emerald-400"
          />
        </Section>
      </div>

      <Section title="Punctuation Usage Trends" description="Punctuation rate patterns over time">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <TrendChart
            data={data.trends.punctuation.period}
            label="Period rate"
            color="text-violet-400"
          />
          <TrendChart
            data={data.trends.punctuation.comma}
            label="Comma rate"
            color="text-amber-400"
          />
          <TrendChart
            data={data.trends.punctuation.exclamation}
            label="Exclamation rate"
            color="text-pink-400"
          />
          <TrendChart
            data={data.trends.punctuation.question}
            label="Question rate"
            color="text-blue-400"
          />
        </div>
      </Section>

      <Section
        title="Detailed Current Metrics"
        description="Full breakdown of recent stylometric averages"
      >
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <div className="p-3 rounded bg-gray-900 border border-gray-700">
            <p className="text-xs text-gray-500 mb-1">Sentence Length</p>
            <p className="text-lg font-semibold text-cyan-400">
              {data.current.avgSentenceLength?.toFixed(1) ?? '--'}
            </p>
          </div>
          <div className="p-3 rounded bg-gray-900 border border-gray-700">
            <p className="text-xs text-gray-500 mb-1">Vocab Richness</p>
            <p className="text-lg font-semibold text-emerald-400">
              {data.current.avgVocabularyRichness?.toFixed(3) ?? '--'}
            </p>
          </div>
          <div className="p-3 rounded bg-gray-900 border border-gray-700">
            <p className="text-xs text-gray-500 mb-1">Period Rate</p>
            <p className="text-lg font-semibold text-violet-400">
              {data.current.avgPunctuationPeriod?.toFixed(3) ?? '--'}
            </p>
          </div>
          <div className="p-3 rounded bg-gray-900 border border-gray-700">
            <p className="text-xs text-gray-500 mb-1">Comma Rate</p>
            <p className="text-lg font-semibold text-amber-400">
              {data.current.avgPunctuationComma?.toFixed(3) ?? '--'}
            </p>
          </div>
          <div className="p-3 rounded bg-gray-900 border border-gray-700">
            <p className="text-xs text-gray-500 mb-1">Exclamation Rate</p>
            <p className="text-lg font-semibold text-pink-400">
              {data.current.avgPunctuationExclamation?.toFixed(3) ?? '--'}
            </p>
          </div>
          <div className="p-3 rounded bg-gray-900 border border-gray-700">
            <p className="text-xs text-gray-500 mb-1">Question Rate</p>
            <p className="text-lg font-semibold text-blue-400">
              {data.current.avgPunctuationQuestion?.toFixed(3) ?? '--'}
            </p>
          </div>
        </div>
      </Section>
    </div>
  );
}
