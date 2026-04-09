'use client';

import { useState, useEffect, useCallback } from 'react';
import type { PatternType } from '@/types';

interface StoredPatternResponse {
  id: number;
  type: PatternType;
  description: string;
  evidenceCount: number;
  editEvidenceCount: number;
  rejectionEvidenceCount: number;
  weightedScore: number;
  createdAt: string;
  updatedAt: string;
}

interface PatternStatsResponse {
  total: number;
  byType: Record<PatternType, number>;
  highConfidence: number;
  lowConfidence: number;
  avgEvidenceCount: number;
  totalEditEvidence: number;
  totalRejectionEvidence: number;
  avgWeightedScore: number;
}

interface ContradictionResponse {
  patternA: { id?: number; description: string; evidenceCount: number };
  patternB: { id?: number; description: string; evidenceCount: number };
  contradictionType: string;
  severity: 'high' | 'medium' | 'low';
  explanation: string;
}

interface FeedbackStatsResponse {
  total: number;
  approvals: number;
  rejections: number;
  edits: number;
}

interface SourceAccountResponse {
  handle: string;
  tier: number;
  contribution: number;
}

interface KnowledgeBaseData {
  patterns: StoredPatternResponse[];
  stats: PatternStatsResponse;
  contradictions: ContradictionResponse[];
  feedbackStats: FeedbackStatsResponse;
  sourceAccounts: SourceAccountResponse[];
}

const PATTERN_TYPE_LABELS: Record<PatternType, string> = {
  voice: 'Voice Preferences',
  hook: 'Hook Patterns',
  topic: 'Topic Preferences',
  rejection: 'Things to Avoid',
  edit: 'Edit Preferences',
};

const PATTERN_TYPE_COLORS: Record<PatternType, string> = {
  voice: 'bg-purple-500/20 text-purple-400 border-purple-500/50',
  hook: 'bg-blue-500/20 text-blue-400 border-blue-500/50',
  topic: 'bg-green-500/20 text-green-400 border-green-500/50',
  rejection: 'bg-red-500/20 text-red-400 border-red-500/50',
  edit: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50',
};

function getConfidenceLabel(pattern: StoredPatternResponse): string {
  if (pattern.editEvidenceCount >= 3) return 'High (edit-verified)';
  if (pattern.weightedScore >= 10) return 'High';
  if (pattern.weightedScore >= 5 || pattern.editEvidenceCount >= 1) return 'Medium';
  return 'Low';
}

function getConfidenceColor(pattern: StoredPatternResponse): string {
  if (pattern.editEvidenceCount >= 3 || pattern.weightedScore >= 10) return 'text-green-400';
  if (pattern.weightedScore >= 5 || pattern.editEvidenceCount >= 1) return 'text-yellow-400';
  return 'text-gray-400';
}

function getSeverityColor(severity: 'high' | 'medium' | 'low'): string {
  switch (severity) {
    case 'high':
      return 'border-red-500/50 bg-red-900/20';
    case 'medium':
      return 'border-yellow-500/50 bg-yellow-900/20';
    case 'low':
      return 'border-gray-500/50 bg-gray-800';
  }
}

function formatTimeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  return `${Math.floor(diffDays / 30)} months ago`;
}

interface PatternCardProps {
  pattern: StoredPatternResponse;
  isExpanded: boolean;
  hasConflict: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onEdit: (newDescription: string) => void;
}

function PatternCard({
  pattern,
  isExpanded,
  hasConflict,
  onToggle,
  onDelete,
  onEdit,
}: PatternCardProps): React.ReactElement {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(pattern.description);

  const handleSave = (): void => {
    if (editValue.trim() && editValue !== pattern.description) {
      onEdit(editValue.trim());
    }
    setIsEditing(false);
  };

  const handleCancel = (): void => {
    setEditValue(pattern.description);
    setIsEditing(false);
  };

  const borderClass = hasConflict
    ? 'border-orange-500/50 bg-orange-900/10'
    : 'border-gray-700 bg-gray-800';

  return (
    <div className={`rounded-lg border p-4 transition-all ${borderClass}`}>
      <div className="flex items-start justify-between gap-4 cursor-pointer" onClick={onToggle}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <span
              className={`px-2 py-0.5 text-xs font-medium rounded border ${PATTERN_TYPE_COLORS[pattern.type]}`}
            >
              {PATTERN_TYPE_LABELS[pattern.type]}
            </span>
            {hasConflict && (
              <span className="px-2 py-0.5 text-xs font-medium rounded border border-orange-500/50 bg-orange-500/20 text-orange-400">
                Conflict
              </span>
            )}
          </div>
          {isEditing ? (
            <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
              <textarea
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className="w-full p-2 text-sm bg-gray-900 border border-gray-600 rounded text-gray-200 focus:border-blue-500 focus:outline-none"
                rows={2}
              />
              <div className="flex gap-2">
                <button
                  onClick={handleSave}
                  className="px-3 py-1 text-xs font-medium rounded bg-blue-600 text-white hover:bg-blue-500"
                >
                  Save
                </button>
                <button
                  onClick={handleCancel}
                  className="px-3 py-1 text-xs font-medium rounded bg-gray-600 text-gray-200 hover:bg-gray-500"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <p className="text-gray-200 text-sm">{pattern.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-medium ${getConfidenceColor(pattern)}`}>
            {getConfidenceLabel(pattern)}
          </span>
          <span className="text-gray-500">
            {isExpanded ? (
              <ChevronUpIcon className="w-4 h-4" />
            ) : (
              <ChevronDownIcon className="w-4 h-4" />
            )}
          </span>
        </div>
      </div>

      {isExpanded && !isEditing && (
        <div className="mt-4 pt-4 border-t border-gray-700">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider">Total Evidence</p>
              <p className="text-lg font-semibold text-white">{pattern.evidenceCount}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider">From Edits</p>
              <p className="text-lg font-semibold text-yellow-400">{pattern.editEvidenceCount}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider">From Rejections</p>
              <p className="text-lg font-semibold text-red-400">{pattern.rejectionEvidenceCount}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider">Weighted Score</p>
              <p className="text-lg font-semibold text-blue-400">{pattern.weightedScore}</p>
            </div>
          </div>
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>
              Created {formatTimeAgo(pattern.createdAt)} &middot; Updated{' '}
              {formatTimeAgo(pattern.updatedAt)}
            </span>
            <div className="flex gap-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setIsEditing(true);
                }}
                className="px-2 py-1 text-xs rounded border border-gray-600 text-gray-400 hover:text-blue-400 hover:border-blue-500/50"
              >
                Edit
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                className="px-2 py-1 text-xs rounded border border-gray-600 text-gray-400 hover:text-red-400 hover:border-red-500/50"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ChevronDownIcon({ className }: { className?: string }): React.ReactElement {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function ChevronUpIcon({ className }: { className?: string }): React.ReactElement {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
    </svg>
  );
}

interface ConflictCardProps {
  contradiction: ContradictionResponse;
}

function ConflictCard({ contradiction }: ConflictCardProps): React.ReactElement {
  return (
    <div className={`rounded-lg border p-4 ${getSeverityColor(contradiction.severity)}`}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-medium uppercase tracking-wider text-gray-400">
          {contradiction.contradictionType.replace('_', ' ')}
        </span>
        <span
          className={`px-2 py-0.5 text-xs font-medium rounded ${
            contradiction.severity === 'high'
              ? 'bg-red-500/30 text-red-300'
              : contradiction.severity === 'medium'
                ? 'bg-yellow-500/30 text-yellow-300'
                : 'bg-gray-500/30 text-gray-300'
          }`}
        >
          {contradiction.severity}
        </span>
      </div>
      <div className="space-y-2 mb-3">
        <div className="p-2 bg-gray-900/50 rounded text-sm text-gray-300">
          &ldquo;{contradiction.patternA.description}&rdquo;
          <span className="text-gray-500 ml-2">
            ({contradiction.patternA.evidenceCount} evidence)
          </span>
        </div>
        <div className="text-center text-gray-500 text-xs">vs</div>
        <div className="p-2 bg-gray-900/50 rounded text-sm text-gray-300">
          &ldquo;{contradiction.patternB.description}&rdquo;
          <span className="text-gray-500 ml-2">
            ({contradiction.patternB.evidenceCount} evidence)
          </span>
        </div>
      </div>
      <p className="text-xs text-gray-400">{contradiction.explanation}</p>
    </div>
  );
}

export default function KnowledgeBasePage(): React.ReactElement {
  const [data, setData] = useState<KnowledgeBaseData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedPatterns, setExpandedPatterns] = useState<Set<number>>(new Set());
  const [filterType, setFilterType] = useState<PatternType | 'all'>('all');
  const [showConflictsOnly, setShowConflictsOnly] = useState(false);

  const fetchData = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch('/api/knowledge');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const result = (await response.json()) as KnowledgeBaseData;
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch knowledge base');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const handleDeletePattern = async (patternId: number): Promise<void> => {
    if (!confirm('Are you sure you want to delete this pattern?')) return;

    try {
      const response = await fetch(`/api/patterns/${patternId}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Failed to delete pattern');
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete pattern');
    }
  };

  const handleEditPattern = async (patternId: number, newDescription: string): Promise<void> => {
    try {
      const response = await fetch(`/api/patterns/${patternId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: newDescription }),
      });
      if (!response.ok) throw new Error('Failed to update pattern');
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update pattern');
    }
  };

  const togglePattern = (id: number): void => {
    setExpandedPatterns((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const conflictingPatternIds = new Set(
    data?.contradictions.flatMap((c) => [c.patternA.id, c.patternB.id].filter(Boolean)) ?? []
  );

  const filteredPatterns =
    data?.patterns.filter((p) => {
      if (filterType !== 'all' && p.type !== filterType) return false;
      if (showConflictsOnly && !conflictingPatternIds.has(p.id)) return false;
      return true;
    }) ?? [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">Loading knowledge base...</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-lg bg-red-900/20 border border-red-500/50 p-4">
        <p className="text-red-400">Failed to load knowledge base</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Knowledge Base</h1>
        <p className="text-sm text-gray-400 mt-1">
          Learned {data.stats.total} pattern{data.stats.total !== 1 ? 's' : ''} from{' '}
          {data.feedbackStats.total} feedback item{data.feedbackStats.total !== 1 ? 's' : ''}
        </p>
      </div>

      {error !== null && (
        <div className="rounded-lg bg-red-900/20 border border-red-500/50 p-4">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Total Patterns"
          value={data.stats.total}
          subtext={`${data.stats.highConfidence} high confidence`}
          highlight={false}
        />
        <StatCard
          label="Feedback Items"
          value={data.feedbackStats.total}
          subtext={`${data.feedbackStats.edits} edits, ${data.feedbackStats.rejections} rejections`}
          highlight={false}
        />
        <StatCard
          label="Avg Evidence"
          value={data.stats.avgEvidenceCount.toFixed(1)}
          subtext={`${data.stats.totalEditEvidence} from edits`}
          highlight={false}
        />
        <StatCard
          label="Conflicts"
          value={data.contradictions.length}
          subtext={
            data.contradictions.filter((c) => c.severity === 'high').length + ' high severity'
          }
          highlight={data.contradictions.some((c) => c.severity === 'high')}
        />
      </div>

      {data.contradictions.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-medium text-white">Conflicting Patterns</h2>
          <p className="text-sm text-gray-400">
            These patterns may contradict each other. Consider resolving them to improve content
            generation.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            {data.contradictions.map((contradiction, index) => (
              <ConflictCard key={index} contradiction={contradiction} />
            ))}
          </div>
        </div>
      )}

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium text-white">Learned Patterns</h2>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-gray-400">
              <input
                type="checkbox"
                checked={showConflictsOnly}
                onChange={(e) => setShowConflictsOnly(e.target.checked)}
                className="rounded bg-gray-700 border-gray-600"
              />
              Show conflicts only
            </label>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as PatternType | 'all')}
              className="px-3 py-1.5 text-sm bg-gray-800 border border-gray-700 rounded text-gray-300 focus:border-blue-500 focus:outline-none"
            >
              <option value="all">All Types</option>
              {Object.entries(PATTERN_TYPE_LABELS).map(([type, label]) => (
                <option key={type} value={type}>
                  {label} ({data.stats.byType[type as PatternType]})
                </option>
              ))}
            </select>
          </div>
        </div>

        {filteredPatterns.length === 0 ? (
          <div className="rounded-lg bg-gray-800 p-8 text-center">
            <p className="text-gray-400">No patterns match the current filter.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredPatterns.map((pattern) => (
              <PatternCard
                key={pattern.id}
                pattern={pattern}
                isExpanded={expandedPatterns.has(pattern.id)}
                hasConflict={conflictingPatternIds.has(pattern.id)}
                onToggle={() => togglePattern(pattern.id)}
                onDelete={() => void handleDeletePattern(pattern.id)}
                onEdit={(desc) => void handleEditPattern(pattern.id, desc)}
              />
            ))}
          </div>
        )}
      </div>

      {data.sourceAccounts.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-medium text-white">Source Accounts</h2>
          <p className="text-sm text-gray-400">
            Content from these accounts contributes to your knowledge base.
          </p>
          <div className="grid gap-2 md:grid-cols-3 lg:grid-cols-4">
            {data.sourceAccounts.slice(0, 20).map((account) => (
              <div
                key={account.handle}
                className="flex items-center justify-between p-3 rounded-lg bg-gray-800 border border-gray-700"
              >
                <div>
                  <span className="text-sm text-gray-200">@{account.handle}</span>
                  <span
                    className={`ml-2 text-xs ${account.tier === 1 ? 'text-blue-400' : 'text-gray-500'}`}
                  >
                    Tier {account.tier}
                  </span>
                </div>
                <span className="text-xs text-gray-500">
                  {account.contribution} source{account.contribution !== 1 ? 's' : ''}
                </span>
              </div>
            ))}
          </div>
          {data.sourceAccounts.length > 20 && (
            <p className="text-sm text-gray-500 text-center">
              +{data.sourceAccounts.length - 20} more accounts
            </p>
          )}
        </div>
      )}
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: number | string;
  subtext: string;
  highlight: boolean;
}

function StatCard({ label, value, subtext, highlight }: StatCardProps): React.ReactElement {
  const borderClass = highlight
    ? 'border-orange-500/50 bg-orange-900/10'
    : 'border-gray-700 bg-gray-800';
  const textClass = highlight ? 'text-orange-400' : 'text-white';

  return (
    <div className={`rounded-lg p-4 border ${borderClass}`}>
      <p className="text-xs text-gray-500 uppercase tracking-wider">{label}</p>
      <p className={`text-2xl font-semibold ${textClass}`}>{value}</p>
      <p className="text-xs text-gray-500 mt-1">{subtext}</p>
    </div>
  );
}
