'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Post, VoiceScore, StyleSignatureData } from '@/types';

interface DebugTraceEntry {
  node: string;
  message?: string;
  timestamp?: string;
  duration_ms?: number;
  state?: Record<string, unknown>;
}

interface DebugTraceResponse {
  job_id: string;
  found: boolean;
  job_info: {
    job_id: string;
    thread_id: string;
    status: 'running' | 'completed';
    content_type: string;
    source_count: number;
    started_at: string;
    completed_at: string | null;
    final_status: string | null;
    error: string | null;
  } | null;
  checkpoints: Array<{
    checkpoint_id: string;
    created_at: string;
    state: Record<string, unknown>;
    metadata: Record<string, unknown>;
  }> | null;
  trace: DebugTraceEntry[] | null;
}

interface QueuePost extends Post {
  queuePriority: number;
}

interface HumanizerChange {
  patternName: string;
  original: string;
  replacement: string;
  applied: boolean;
}

interface HumanizerResult {
  humanized: string;
  patterns_found: number;
  changes_made: number;
  changes: HumanizerChange[];
}

interface ExpandedPostDetailProps {
  post: QueuePost;
  onApprove: (starred: boolean) => void;
  onReject: () => void;
  onEdit: (newContent: string, diffBefore: string, diffAfter: string) => void;
  onClose: () => void;
}

type ActionMode = 'view' | 'edit';
type ContentView = 'humanized' | 'raw' | 'diff';

export function ExpandedPostDetail({
  post,
  onApprove,
  onReject,
  onEdit,
  onClose,
}: ExpandedPostDetailProps): React.ReactElement {
  const [mode, setMode] = useState<ActionMode>('view');
  const [editContent, setEditContent] = useState(post.content);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [showGraphTrace, setShowGraphTrace] = useState(false);
  const [graphTrace, setGraphTrace] = useState<DebugTraceResponse | null>(null);
  const [graphTraceLoading, setGraphTraceLoading] = useState(false);
  const [graphTraceError, setGraphTraceError] = useState<string | null>(null);

  // Humanizer preview state
  const [humanizerResult, setHumanizerResult] = useState<HumanizerResult | null>(null);
  const [humanizerLoading, setHumanizerLoading] = useState(false);
  const [humanizerError, setHumanizerError] = useState<string | null>(null);
  const [contentView, setContentView] = useState<ContentView>('humanized');

  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (mode === 'edit' && editTextareaRef.current) {
      editTextareaRef.current.focus();
      editTextareaRef.current.setSelectionRange(editContent.length, editContent.length);
    }
  }, [mode, editContent.length]);

  const handleCopy = useCallback(async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(post.content);
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    } catch {
      // Fallback - do nothing
    }
  }, [post.content]);

  const handleCopySync = useCallback((): void => {
    void handleCopy();
  }, [handleCopy]);

  const handleApprove = useCallback(
    (starred: boolean): void => {
      onApprove(starred);
    },
    [onApprove]
  );

  const handleEditSave = useCallback((): void => {
    if (editContent.trim() !== post.content) {
      onEdit(editContent.trim(), post.content, editContent.trim());
    }
    setMode('view');
  }, [editContent, post.content, onEdit]);

  const handleEditCancel = useCallback((): void => {
    setEditContent(post.content);
    setMode('view');
  }, [post.content]);

  const handleShowGraphTrace = useCallback(async (): Promise<void> => {
    if (!post.langGraphJobId) return;

    setGraphTraceLoading(true);
    setGraphTraceError(null);

    try {
      const response = await fetch(`/api/langgraph/debug/${post.langGraphJobId}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch graph trace: ${response.status}`);
      }
      const data = (await response.json()) as DebugTraceResponse;
      setGraphTrace(data);
      setShowGraphTrace(true);
    } catch (error) {
      setGraphTraceError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setGraphTraceLoading(false);
    }
  }, [post.langGraphJobId]);

  const handleCloseGraphTrace = useCallback((): void => {
    setShowGraphTrace(false);
    setGraphTrace(null);
    setGraphTraceError(null);
  }, []);

  const handleAnalyzeHumanizer = useCallback(async (): Promise<void> => {
    setHumanizerLoading(true);
    setHumanizerError(null);

    try {
      const response = await fetch('/api/humanize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: post.content }),
      });
      if (!response.ok) {
        throw new Error(`Failed to analyze: ${response.status}`);
      }
      const data = (await response.json()) as {
        success: boolean;
        result: HumanizerResult | null;
        error: string | null;
      };
      if (!data.success || !data.result) {
        throw new Error(data.error ?? 'Unknown error');
      }
      setHumanizerResult(data.result);
    } catch (error) {
      setHumanizerError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setHumanizerLoading(false);
    }
  }, [post.content]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (mode === 'edit') {
          setMode('view');
          setEditContent(post.content);
        } else {
          onClose();
        }
        return;
      }

      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        if (e.key === 'Enter' && e.ctrlKey && mode === 'edit') {
          e.preventDefault();
          handleEditSave();
        }
        return;
      }

      if (mode === 'view') {
        const key = e.key.toLowerCase();
        if (key === 'a') {
          e.preventDefault();
          handleApprove(false);
        } else if (key === 's') {
          e.preventDefault();
          handleApprove(true);
        } else if (key === 'r') {
          e.preventDefault();
          onReject();
        } else if (key === 'e') {
          e.preventDefault();
          setMode('edit');
        } else if (key === 'c') {
          e.preventDefault();
          void handleCopy();
        }
      }
    },
    [mode, post.content, onClose, handleApprove, onReject, handleEditSave, handleCopy]
  );

  const voiceScore = post.voiceEvaluation?.score ?? null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <div className="bg-gray-900 rounded-xl border border-gray-700 max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-white">Post Detail</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors p-1"
            title="Close (Escape)"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          <ContentSection
            post={post}
            editMode={mode === 'edit'}
            editContent={editContent}
            onEditContentChange={setEditContent}
            onCopy={handleCopySync}
            copyFeedback={copyFeedback}
            textareaRef={editTextareaRef}
          />

          {voiceScore && <ConfidenceBreakdown score={voiceScore} />}

          {post.stylometricSignature && (
            <StylometricScoreSection signature={post.stylometricSignature} />
          )}

          <ReasoningSection reasoning={post.reasoning} />

          <HumanizerPreviewSection
            result={humanizerResult}
            loading={humanizerLoading}
            error={humanizerError}
            contentView={contentView}
            currentContent={post.content}
            onAnalyze={() => void handleAnalyzeHumanizer()}
            onViewChange={setContentView}
          />

          {post.langGraphJobId && (
            <GraphTraceSection
              jobId={post.langGraphJobId}
              showTrace={showGraphTrace}
              trace={graphTrace}
              loading={graphTraceLoading}
              error={graphTraceError}
              onShowTrace={() => void handleShowGraphTrace()}
              onCloseTrace={handleCloseGraphTrace}
            />
          )}
        </div>

        <ActionBar
          mode={mode}
          onApprove={() => handleApprove(false)}
          onApproveStarred={() => handleApprove(true)}
          onReject={onReject}
          onEdit={() => setMode('edit')}
          onEditSave={handleEditSave}
          onEditCancel={handleEditCancel}
        />
      </div>
    </div>
  );
}

interface ContentSectionProps {
  post: QueuePost;
  editMode: boolean;
  editContent: string;
  onEditContentChange: (content: string) => void;
  onCopy: () => void;
  copyFeedback: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
}

function ContentSection({
  post,
  editMode,
  editContent,
  onEditContentChange,
  onCopy,
  copyFeedback,
  textareaRef,
}: ContentSectionProps): React.ReactElement {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-400 capitalize">{post.type}</span>
          <ConfidenceBadge score={post.confidenceScore} />
        </div>
        {!editMode && (
          <button
            onClick={onCopy}
            className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-white transition-colors"
          >
            {copyFeedback ? (
              <>
                <svg
                  className="w-4 h-4 text-green-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                <span className="text-green-400">Copied!</span>
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                  />
                </svg>
                <span>Copy</span>
              </>
            )}
          </button>
        )}
      </div>

      {editMode ? (
        <textarea
          ref={textareaRef}
          value={editContent}
          onChange={(e) => onEditContentChange(e.target.value)}
          className="w-full bg-gray-800 border border-gray-600 rounded-lg p-4 text-white text-base leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          rows={6}
          placeholder="Edit post content..."
        />
      ) : (
        <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
          <p className="text-white text-base leading-relaxed whitespace-pre-wrap">{post.content}</p>
        </div>
      )}
    </div>
  );
}

interface ConfidenceBadgeProps {
  score: number;
}

function ConfidenceBadge({ score }: ConfidenceBadgeProps): React.ReactElement {
  const level = score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low';
  const styles = {
    high: 'bg-green-500/20 text-green-400 border-green-500/50',
    medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50',
    low: 'bg-red-500/20 text-red-400 border-red-500/50',
  };

  return (
    <span className={`px-2 py-0.5 text-xs font-medium rounded border ${styles[level]}`}>
      {Math.round(score)}%
    </span>
  );
}

interface ConfidenceBreakdownProps {
  score: VoiceScore;
}

function ConfidenceBreakdown({ score }: ConfidenceBreakdownProps): React.ReactElement {
  const dimensions = [
    { label: 'Voice', value: score.voice, color: 'blue' },
    { label: 'Hook', value: score.hook, color: 'purple' },
    { label: 'Topic', value: score.topic, color: 'cyan' },
    { label: 'Originality', value: score.originality, color: 'orange' },
  ];

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-gray-300">Confidence Breakdown</h3>
      <div className="grid grid-cols-2 gap-3">
        {dimensions.map((dim) => (
          <DimensionBar key={dim.label} label={dim.label} value={dim.value} color={dim.color} />
        ))}
      </div>
      <div className="flex items-center gap-2 pt-2 border-t border-gray-700">
        <span className="text-sm text-gray-400">Overall:</span>
        <span
          className={`text-sm font-semibold ${
            score.overall >= 70
              ? 'text-green-400'
              : score.overall >= 40
                ? 'text-yellow-400'
                : 'text-red-400'
          }`}
        >
          {Math.round(score.overall)}%
        </span>
      </div>
    </div>
  );
}

interface DimensionBarProps {
  label: string;
  value: number;
  color: string;
}

function DimensionBar({ label, value, color }: DimensionBarProps): React.ReactElement {
  const colorClasses: Record<string, { bg: string; fill: string }> = {
    blue: { bg: 'bg-blue-500/20', fill: 'bg-blue-500' },
    purple: { bg: 'bg-purple-500/20', fill: 'bg-purple-500' },
    cyan: { bg: 'bg-cyan-500/20', fill: 'bg-cyan-500' },
    orange: { bg: 'bg-orange-500/20', fill: 'bg-orange-500' },
  };

  const colors = colorClasses[color] ?? colorClasses.blue;
  const widthPct = Math.min(value, 100);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400">{label}</span>
        <span className="text-xs font-medium text-gray-300">{Math.round(value)}%</span>
      </div>
      <div className={`h-2 rounded-full ${colors.bg} overflow-hidden`}>
        <div
          className={`h-full ${colors.fill} rounded-full transition-all`}
          style={{ width: `${widthPct}%` }}
        />
      </div>
    </div>
  );
}

interface ReasoningSectionProps {
  reasoning: Post['reasoning'];
}

function ReasoningSection({ reasoning }: ReasoningSectionProps): React.ReactElement {
  const hasConcerns = Array.isArray(reasoning.concerns) && reasoning.concerns.length > 0;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-gray-300">Reasoning</h3>
      <div className="bg-gray-800/30 rounded-lg p-4 space-y-4 border border-gray-700/50">
        {reasoning.source && <ReasoningItem label="Source" value={reasoning.source} />}
        {reasoning.whyItWorks && (
          <ReasoningItem label="Why it works" value={reasoning.whyItWorks} />
        )}
        {reasoning.timing && <ReasoningItem label="Timing" value={reasoning.timing} />}
        {hasConcerns && (
          <div className="space-y-1">
            <span className="text-xs text-gray-500 uppercase tracking-wide">Concerns</span>
            <ul className="list-disc list-inside space-y-1">
              {reasoning.concerns.map((concern, i) => (
                <li key={i} className="text-sm text-yellow-400/90">
                  {concern}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

interface ReasoningItemProps {
  label: string;
  value: string;
}

function ReasoningItem({ label, value }: ReasoningItemProps): React.ReactElement {
  return (
    <div className="space-y-1">
      <span className="text-xs text-gray-500 uppercase tracking-wide">{label}</span>
      <p className="text-sm text-gray-300">{value}</p>
    </div>
  );
}

interface StylometricScoreSectionProps {
  signature: StyleSignatureData;
}

function StylometricScoreSection({ signature }: StylometricScoreSectionProps): React.ReactElement {
  const formatPercent = (value: number): string => `${(value * 100).toFixed(1)}%`;
  const formatDecimal = (value: number): string => value.toFixed(2);

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-gray-300">Stylometric Signature</h3>
      <div className="bg-gray-800/30 rounded-lg p-4 border border-gray-700/50">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-3">
            <div>
              <span className="text-xs text-gray-500 uppercase tracking-wide">Sentence Length</span>
              <div className="flex items-center gap-3 mt-1">
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-400">Avg:</span>
                  <span className="text-sm font-medium text-cyan-400">
                    {formatDecimal(signature.sentenceLength.mean)}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-400">σ:</span>
                  <span className="text-sm font-medium text-cyan-400">
                    {formatDecimal(signature.sentenceLength.stdDev)}
                  </span>
                </div>
              </div>
            </div>

            <div>
              <span className="text-xs text-gray-500 uppercase tracking-wide">
                Vocabulary Richness
              </span>
              <div className="flex items-center gap-3 mt-1">
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-400">TTR:</span>
                  <span className="text-sm font-medium text-emerald-400">
                    {formatPercent(signature.vocabulary.typeTokenRatio)}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-400">Hapax:</span>
                  <span className="text-sm font-medium text-emerald-400">
                    {formatPercent(signature.vocabulary.hapaxRatio)}
                  </span>
                </div>
              </div>
            </div>

            <div>
              <span className="text-xs text-gray-500 uppercase tracking-wide">
                Syntactic Complexity
              </span>
              <div className="flex flex-wrap items-center gap-3 mt-1">
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-400">Depth:</span>
                  <span className="text-sm font-medium text-violet-400">
                    {formatDecimal(signature.syntactic.avgClauseDepth)}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-400">Words/Clause:</span>
                  <span className="text-sm font-medium text-violet-400">
                    {formatDecimal(signature.syntactic.avgWordsPerClause)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <span className="text-xs text-gray-500 uppercase tracking-wide">
                Punctuation Rates
              </span>
              <div className="grid grid-cols-3 gap-x-2 gap-y-1 mt-1">
                <PunctuationStat label="." value={signature.punctuation.periodRate} />
                <PunctuationStat label="," value={signature.punctuation.commaRate} />
                <PunctuationStat label="!" value={signature.punctuation.exclamationRate} />
                <PunctuationStat label="?" value={signature.punctuation.questionRate} />
                <PunctuationStat label="-" value={signature.punctuation.dashRate} />
                <PunctuationStat label="..." value={signature.punctuation.ellipsisRate} />
              </div>
            </div>

            <div>
              <span className="text-xs text-gray-500 uppercase tracking-wide">
                Top Function Words
              </span>
              <div className="flex flex-wrap gap-1.5 mt-1">
                <FunctionWordBadge word="the" value={signature.functionWords.the} />
                <FunctionWordBadge word="and" value={signature.functionWords.and} />
                <FunctionWordBadge word="to" value={signature.functionWords.to} />
                <FunctionWordBadge word="of" value={signature.functionWords.of} />
                <FunctionWordBadge word="a" value={signature.functionWords.a} />
              </div>
            </div>
          </div>
        </div>

        {signature.metadata && (
          <div className="mt-3 pt-3 border-t border-gray-700/50 flex items-center gap-4 text-xs text-gray-500">
            <span>Text length: {signature.metadata.textLength} chars</span>
            {signature.metadata.generatedAt && (
              <span>
                Generated: {new Date(signature.metadata.generatedAt).toLocaleDateString()}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface PunctuationStatProps {
  label: string;
  value: number;
}

function PunctuationStat({ label, value }: PunctuationStatProps): React.ReactElement {
  return (
    <div className="flex items-center gap-1">
      <span className="text-xs text-gray-400 font-mono w-4">{label}</span>
      <span className="text-xs font-medium text-amber-400">{(value * 100).toFixed(1)}%</span>
    </div>
  );
}

interface FunctionWordBadgeProps {
  word: string;
  value: number;
}

function FunctionWordBadge({ word, value }: FunctionWordBadgeProps): React.ReactElement {
  return (
    <span className="px-1.5 py-0.5 bg-gray-700/50 rounded text-xs">
      <span className="text-gray-400">{word}:</span>{' '}
      <span className="text-pink-400 font-medium">{(value * 100).toFixed(1)}%</span>
    </span>
  );
}

interface ActionBarProps {
  mode: ActionMode;
  onApprove: () => void;
  onApproveStarred: () => void;
  onReject: () => void;
  onEdit: () => void;
  onEditSave: () => void;
  onEditCancel: () => void;
}

function ActionBar({
  mode,
  onApprove,
  onApproveStarred,
  onReject,
  onEdit,
  onEditSave,
  onEditCancel,
}: ActionBarProps): React.ReactElement {
  if (mode === 'edit') {
    return (
      <div className="p-4 border-t border-gray-700 flex items-center justify-between">
        <div className="text-xs text-gray-500">
          <kbd className="px-1.5 py-0.5 bg-gray-700 rounded">Ctrl+Enter</kbd> to save
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onEditCancel}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm font-medium rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onEditSave}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Save Changes
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 border-t border-gray-700 flex items-center justify-between">
      <div className="flex items-center gap-4 text-xs text-gray-500">
        <span>
          <kbd className="px-1.5 py-0.5 bg-gray-700 rounded">A</kbd> approve
        </span>
        <span>
          <kbd className="px-1.5 py-0.5 bg-gray-700 rounded">S</kbd> star
        </span>
        <span>
          <kbd className="px-1.5 py-0.5 bg-gray-700 rounded">R</kbd> reject
        </span>
        <span>
          <kbd className="px-1.5 py-0.5 bg-gray-700 rounded">E</kbd> edit
        </span>
        <span>
          <kbd className="px-1.5 py-0.5 bg-gray-700 rounded">C</kbd> copy
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onEdit}
          className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm font-medium rounded-lg transition-colors"
        >
          Edit
        </button>
        <button
          onClick={onReject}
          className="px-4 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-500/50 text-sm font-medium rounded-lg transition-colors"
        >
          Reject
        </button>
        <button
          onClick={onApprove}
          className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white text-sm font-medium rounded-lg transition-colors"
        >
          Approve
        </button>
        <button
          onClick={onApproveStarred}
          className="px-4 py-2 bg-yellow-600 hover:bg-yellow-500 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-1"
          title="Approve as exceptional"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
          </svg>
          Star
        </button>
      </div>
    </div>
  );
}

interface HumanizerPreviewSectionProps {
  result: HumanizerResult | null;
  loading: boolean;
  error: string | null;
  contentView: ContentView;
  currentContent: string;
  onAnalyze: () => void;
  onViewChange: (view: ContentView) => void;
}

function HumanizerPreviewSection({
  result,
  loading,
  error,
  contentView,
  currentContent,
  onAnalyze,
  onViewChange,
}: HumanizerPreviewSectionProps): React.ReactElement {
  const appliedChanges = result?.changes.filter((c) => c.applied) ?? [];
  const hasChanges = appliedChanges.length > 0;

  // Reconstruct raw content by reversing applied changes
  const rawContent = result
    ? appliedChanges.reduce((content, change) => {
        const escaped = change.replacement.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return content.replace(new RegExp(escaped, 'gi'), change.original);
      }, result.humanized)
    : currentContent;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-300">Humanizer Analysis</h3>
        {!result && (
          <button
            onClick={onAnalyze}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-1.5 text-sm bg-purple-600/20 hover:bg-purple-600/30 text-purple-400 border border-purple-500/50 rounded-lg transition-colors disabled:opacity-50"
          >
            {loading ? 'Analyzing...' : 'Analyze Patterns'}
          </button>
        )}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {result && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">
              {result.patterns_found} pattern(s) found, {result.changes_made} change(s) applied
            </span>
            {hasChanges && (
              <div className="flex gap-1 ml-auto">
                {(['humanized', 'raw', 'diff'] as const).map((view) => (
                  <button
                    key={view}
                    onClick={() => onViewChange(view)}
                    className={`px-2 py-1 text-xs rounded ${
                      contentView === view
                        ? 'bg-purple-600 text-white'
                        : 'bg-gray-700 text-gray-400 hover:text-white'
                    }`}
                  >
                    {view.charAt(0).toUpperCase() + view.slice(1)}
                  </button>
                ))}
              </div>
            )}
          </div>

          {hasChanges && contentView === 'diff' && (
            <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700/50 space-y-2">
              {appliedChanges.map((change, i) => (
                <div key={i} className="text-sm">
                  <span className="text-gray-500 text-xs">[{change.patternName}]</span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="line-through text-red-400/70">{change.original}</span>
                    <span className="text-gray-500">→</span>
                    <span className="text-green-400">{change.replacement}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {hasChanges && contentView === 'raw' && (
            <div className="bg-gray-800/50 rounded-lg p-3 border border-red-500/30">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs text-red-400 font-medium">Raw (Pre-Humanizer)</span>
              </div>
              <p className="text-sm text-gray-300 whitespace-pre-wrap">{rawContent}</p>
            </div>
          )}

          {(!hasChanges || contentView === 'humanized') && (
            <p className="text-xs text-gray-500 italic">
              {hasChanges ? 'Viewing humanized content (current)' : 'No AI patterns detected'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

interface GraphTraceSectionProps {
  jobId: string;
  showTrace: boolean;
  trace: DebugTraceResponse | null;
  loading: boolean;
  error: string | null;
  onShowTrace: () => void;
  onCloseTrace: () => void;
}

const NODE_COLORS: Record<string, string> = {
  analyze_source: 'bg-blue-500',
  select_formula: 'bg-purple-500',
  generate_draft: 'bg-indigo-500',
  voice_check: 'bg-green-500',
  slop_check: 'bg-yellow-500',
  stylometric_check: 'bg-orange-500',
  critique: 'bg-red-500',
  rewrite: 'bg-pink-500',
  finalize: 'bg-emerald-500',
  reject: 'bg-red-700',
};

function GraphTraceSection({
  jobId,
  showTrace,
  trace,
  loading,
  error,
  onShowTrace,
  onCloseTrace,
}: GraphTraceSectionProps): React.ReactElement {
  if (!showTrace) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-gray-300">LangGraph Pipeline</h3>
          <button
            onClick={onShowTrace}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-1.5 text-sm bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-400 border border-indigo-500/50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                <span>Loading...</span>
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                  />
                </svg>
                <span>Show Graph Trace</span>
              </>
            )}
          </button>
        </div>
        <p className="text-xs text-gray-500">Job ID: {jobId}</p>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-300">LangGraph Pipeline Trace</h3>
        <button
          onClick={onCloseTrace}
          className="text-gray-400 hover:text-white transition-colors p-1"
          title="Close trace"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      {trace?.found === true ? (
        <div className="space-y-4">
          {trace.job_info && (
            <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700/50 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-gray-500">Status:</span>{' '}
                  <span
                    className={
                      trace.job_info.final_status === 'success'
                        ? 'text-green-400'
                        : trace.job_info.final_status === 'rejected'
                          ? 'text-yellow-400'
                          : 'text-red-400'
                    }
                  >
                    {trace.job_info.final_status ?? trace.job_info.status}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">Content Type:</span>{' '}
                  <span className="text-gray-300">{trace.job_info.content_type}</span>
                </div>
                <div>
                  <span className="text-gray-500">Sources:</span>{' '}
                  <span className="text-gray-300">{trace.job_info.source_count}</span>
                </div>
                <div>
                  <span className="text-gray-500">Started:</span>{' '}
                  <span className="text-gray-300">
                    {new Date(trace.job_info.started_at).toLocaleTimeString()}
                  </span>
                </div>
              </div>
              {trace.job_info.error && (
                <div className="mt-2 text-red-400">Error: {trace.job_info.error}</div>
              )}
            </div>
          )}

          {trace.trace && trace.trace.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wide">
                Execution Flow
              </h4>
              <div className="space-y-1">
                {trace.trace.map((entry, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-2 py-1.5 px-2 bg-gray-800/30 rounded border border-gray-700/30"
                  >
                    <div
                      className={`w-2 h-2 rounded-full ${NODE_COLORS[entry.node] ?? 'bg-gray-500'}`}
                    />
                    <span className="text-xs font-mono text-gray-300 flex-1">
                      {entry.node.replace(/_/g, ' ')}
                    </span>
                    {entry.duration_ms !== undefined && (
                      <span className="text-xs text-gray-500">{entry.duration_ms}ms</span>
                    )}
                    {entry.message && (
                      <span className="text-xs text-gray-400 truncate max-w-[200px]">
                        {entry.message}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {(!trace.trace || trace.trace.length === 0) && (
            <p className="text-sm text-gray-500 italic">
              No execution trace available. The post may have been generated with debug=false.
            </p>
          )}
        </div>
      ) : (
        <div className="text-sm text-gray-500">
          {trace && !trace.found
            ? 'Trace not found. The job data may have been cleaned up.'
            : 'No trace data available.'}
        </div>
      )}
    </div>
  );
}

export default ExpandedPostDetail;
