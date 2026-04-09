'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Post, FeedbackCategory } from '@/types';

interface TrainingPost extends Post {
  queuePriority: number;
}

interface TrainingResponse {
  posts: TrainingPost[];
  total: number;
}

interface SessionStats {
  approved: number;
  rejected: number;
  startTime: number;
}

const TARGET_POSTS = 50;
const TRAINING_TARGET_MINUTES = 45;

function formatElapsedTime(startTime: number): string {
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function calculatePace(processed: number, startTime: number): string {
  const elapsedMinutes = (Date.now() - startTime) / 60000;
  if (elapsedMinutes < 0.5 || processed === 0) return '--';
  const pace = processed / elapsedMinutes;
  return `${pace.toFixed(1)}/min`;
}

interface RapidPostCardProps {
  post: TrainingPost;
  onApprove: () => void;
  onReject: (category: FeedbackCategory) => void;
  showRejectCategories: boolean;
  onToggleReject: () => void;
}

function RapidPostCard({
  post,
  onApprove,
  onReject,
  showRejectCategories,
  onToggleReject,
}: RapidPostCardProps): React.ReactElement {
  return (
    <div className="rounded-xl border-2 border-gray-700 bg-gray-800 p-6 max-w-3xl mx-auto">
      <p className="text-white text-lg leading-relaxed whitespace-pre-wrap">{post.content}</p>

      <div className="mt-6 flex items-center justify-center gap-4">
        <button
          onClick={onApprove}
          className="px-8 py-3 bg-green-600 hover:bg-green-500 text-white font-semibold rounded-lg transition-colors text-lg flex items-center gap-2"
        >
          <span className="text-xs bg-green-700 px-1.5 py-0.5 rounded">A</span>
          Approve
        </button>

        {showRejectCategories ? (
          <div className="flex items-center gap-2">
            <RejectCategoryButton category="generic" label="G" onReject={onReject} />
            <RejectCategoryButton category="tone" label="T" onReject={onReject} />
            <RejectCategoryButton category="hook" label="H" onReject={onReject} />
            <RejectCategoryButton category="value" label="V" onReject={onReject} />
            <RejectCategoryButton category="topic" label="Top" onReject={onReject} />
            <RejectCategoryButton category="timing" label="Tim" onReject={onReject} />
            <RejectCategoryButton category="other" label="O" onReject={onReject} />
            <button
              onClick={onToggleReject}
              className="px-3 py-2 text-gray-400 hover:text-white transition-colors"
            >
              ✕
            </button>
          </div>
        ) : (
          <button
            onClick={onToggleReject}
            className="px-8 py-3 bg-red-600 hover:bg-red-500 text-white font-semibold rounded-lg transition-colors text-lg flex items-center gap-2"
          >
            <span className="text-xs bg-red-700 px-1.5 py-0.5 rounded">R</span>
            Reject
          </button>
        )}
      </div>
    </div>
  );
}

interface RejectCategoryButtonProps {
  category: FeedbackCategory;
  label: string;
  onReject: (category: FeedbackCategory) => void;
}

function RejectCategoryButton({
  category,
  label,
  onReject,
}: RejectCategoryButtonProps): React.ReactElement {
  return (
    <button
      onClick={() => onReject(category)}
      className="px-3 py-2 bg-red-900/50 hover:bg-red-600 text-red-300 hover:text-white font-medium rounded transition-colors text-sm border border-red-700"
      title={category}
    >
      {label}
    </button>
  );
}

interface ProgressBarProps {
  approved: number;
  rejected: number;
  target: number;
}

function ProgressBar({ approved, rejected, target }: ProgressBarProps): React.ReactElement {
  const total = approved + rejected;
  const percentage = Math.min((total / target) * 100, 100);

  return (
    <div className="w-full max-w-3xl mx-auto">
      <div className="flex items-center justify-between text-sm text-gray-400 mb-2">
        <span>
          {total} / {target} posts
        </span>
        <span>{Math.round(percentage)}% complete</span>
      </div>
      <div className="h-3 bg-gray-700 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-blue-600 to-blue-400 transition-all duration-300"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

interface SessionStatsBarProps {
  stats: SessionStats;
}

function SessionStatsBar({ stats }: SessionStatsBarProps): React.ReactElement {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => forceUpdate((n) => n + 1), 1000);
    return (): void => clearInterval(interval);
  }, []);

  const total = stats.approved + stats.rejected;
  const approvalRate = total > 0 ? ((stats.approved / total) * 100).toFixed(0) : '--';

  return (
    <div className="flex items-center justify-center gap-8 text-sm">
      <StatItem label="Time" value={formatElapsedTime(stats.startTime)} />
      <StatItem label="Approved" value={stats.approved.toString()} variant="green" />
      <StatItem label="Rejected" value={stats.rejected.toString()} variant="red" />
      <StatItem label="Approval Rate" value={`${approvalRate}%`} />
      <StatItem label="Pace" value={calculatePace(total, stats.startTime)} />
    </div>
  );
}

interface StatItemProps {
  label: string;
  value: string;
  variant?: 'default' | 'green' | 'red';
}

function StatItem({ label, value, variant = 'default' }: StatItemProps): React.ReactElement {
  const valueColor =
    variant === 'green' ? 'text-green-400' : variant === 'red' ? 'text-red-400' : 'text-white';

  return (
    <div className="text-center">
      <div className={`text-xl font-semibold ${valueColor}`}>{value}</div>
      <div className="text-gray-500 text-xs mt-0.5">{label}</div>
    </div>
  );
}

export default function TrainingPage(): React.ReactElement {
  const [posts, setPosts] = useState<TrainingPost[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showRejectCategories, setShowRejectCategories] = useState(false);
  const [sessionStats, setSessionStats] = useState<SessionStats>({
    approved: 0,
    rejected: 0,
    startTime: Date.now(),
  });
  const [isComplete, setIsComplete] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);

  const fetchPosts = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch('/api/queue?limit=100');

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = (await response.json()) as TrainingResponse;
      setPosts(data.posts);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch posts');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchPosts();
  }, [fetchPosts]);

  const currentPost = posts[currentIndex];

  const advanceToNext = useCallback((): void => {
    if (currentIndex < posts.length - 1) {
      setCurrentIndex((prev) => prev + 1);
      setShowRejectCategories(false);
    } else {
      setIsComplete(true);
    }
  }, [currentIndex, posts.length]);

  const handleApprove = useCallback(async (): Promise<void> => {
    if (currentPost === undefined) return;

    try {
      const response = await fetch(`/api/posts/${currentPost.id}/approve`, { method: 'POST' });
      if (!response.ok) throw new Error('Failed to approve');

      setSessionStats((prev) => ({ ...prev, approved: prev.approved + 1 }));
      advanceToNext();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve post');
    }
  }, [currentPost, advanceToNext]);

  const handleReject = useCallback(
    async (category: FeedbackCategory): Promise<void> => {
      if (currentPost === undefined) return;

      try {
        const response = await fetch(`/api/posts/${currentPost.id}/reject`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ category }),
        });
        if (!response.ok) throw new Error('Failed to reject');

        setSessionStats((prev) => ({ ...prev, rejected: prev.rejected + 1 }));
        advanceToNext();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to reject post');
      }
    },
    [currentPost, advanceToNext]
  );

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (isComplete) return;

      const key = e.key.toLowerCase();

      if (showRejectCategories) {
        switch (key) {
          case 'g':
            e.preventDefault();
            void handleReject('generic');
            break;
          case 't':
            e.preventDefault();
            void handleReject('tone');
            break;
          case 'h':
            e.preventDefault();
            void handleReject('hook');
            break;
          case 'v':
            e.preventDefault();
            void handleReject('value');
            break;
          case 'escape':
            e.preventDefault();
            setShowRejectCategories(false);
            break;
        }
        return;
      }

      switch (key) {
        case 'a':
          e.preventDefault();
          void handleApprove();
          break;
        case 'r':
          e.preventDefault();
          setShowRejectCategories(true);
          break;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return (): void => window.removeEventListener('keydown', handleKeyDown);
  }, [showRejectCategories, handleApprove, handleReject, isComplete]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">Loading training session...</div>
      </div>
    );
  }

  if (isComplete || posts.length === 0) {
    return (
      <div ref={containerRef} className="space-y-8 py-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-white">
            {posts.length === 0 ? 'No Posts Available' : 'Training Complete!'}
          </h1>
          <p className="text-gray-400 mt-2">
            {posts.length === 0
              ? 'There are no posts in the queue to train on.'
              : 'Great job! You processed all available posts.'}
          </p>
        </div>

        {sessionStats.approved + sessionStats.rejected > 0 && (
          <div className="max-w-md mx-auto bg-gray-800 rounded-xl p-6 space-y-4">
            <h2 className="text-lg font-semibold text-white text-center">Session Summary</h2>
            <div className="grid grid-cols-2 gap-4 text-center">
              <div>
                <div className="text-3xl font-bold text-green-400">{sessionStats.approved}</div>
                <div className="text-gray-500 text-sm">Approved</div>
              </div>
              <div>
                <div className="text-3xl font-bold text-red-400">{sessionStats.rejected}</div>
                <div className="text-gray-500 text-sm">Rejected</div>
              </div>
            </div>
            <div className="text-center pt-2 border-t border-gray-700">
              <div className="text-xl font-semibold text-white">
                {formatElapsedTime(sessionStats.startTime)}
              </div>
              <div className="text-gray-500 text-sm">Total Time</div>
            </div>
          </div>
        )}

        <div className="text-center">
          <button
            onClick={() => {
              setIsComplete(false);
              setCurrentIndex(0);
              setSessionStats({ approved: 0, rejected: 0, startTime: Date.now() });
              void fetchPosts();
            }}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg transition-colors"
          >
            Start New Session
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="space-y-6 py-4">
      <div className="text-center">
        <h1 className="text-2xl font-semibold text-white">Training Mode</h1>
        <p className="text-gray-400 text-sm mt-1">
          Rapid-fire review. Target: {TARGET_POSTS}+ posts in {TRAINING_TARGET_MINUTES} minutes.
        </p>
      </div>

      <ProgressBar
        approved={sessionStats.approved}
        rejected={sessionStats.rejected}
        target={TARGET_POSTS}
      />

      {error && (
        <div className="max-w-3xl mx-auto rounded-lg bg-red-900/20 border border-red-500/50 p-4">
          <p className="text-red-400 text-sm text-center">{error}</p>
        </div>
      )}

      <div className="text-center text-gray-500 text-sm">
        Post {currentIndex + 1} of {posts.length}
      </div>

      {currentPost !== undefined && (
        <RapidPostCard
          post={currentPost}
          onApprove={() => void handleApprove()}
          onReject={(category) => void handleReject(category)}
          showRejectCategories={showRejectCategories}
          onToggleReject={() => setShowRejectCategories(!showRejectCategories)}
        />
      )}

      <SessionStatsBar stats={sessionStats} />

      <div className="text-center">
        <TrainingKeyboardHint showRejectMode={showRejectCategories} />
      </div>
    </div>
  );
}

interface TrainingKeyboardHintProps {
  showRejectMode: boolean;
}

function TrainingKeyboardHint({ showRejectMode }: TrainingKeyboardHintProps): React.ReactElement {
  if (showRejectMode) {
    return (
      <div className="flex items-center justify-center gap-4 text-xs text-gray-500">
        <span>
          <kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-gray-400">G</kbd>
          <span className="ml-1">Generic</span>
        </span>
        <span>
          <kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-gray-400">T</kbd>
          <span className="ml-1">Tone</span>
        </span>
        <span>
          <kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-gray-400">H</kbd>
          <span className="ml-1">Hook</span>
        </span>
        <span>
          <kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-gray-400">V</kbd>
          <span className="ml-1">Value</span>
        </span>
        <span>
          <kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-gray-400">Esc</kbd>
          <span className="ml-1">Cancel</span>
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center gap-4 text-xs text-gray-500">
      <span>
        <kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-gray-400">A</kbd>
        <span className="ml-1">Approve</span>
      </span>
      <span>
        <kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-gray-400">R</kbd>
        <span className="ml-1">Reject (select category)</span>
      </span>
    </div>
  );
}
