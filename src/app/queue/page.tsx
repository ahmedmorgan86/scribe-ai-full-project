'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Post } from '@/types';
import { ExpandedPostDetail } from '@/components/queue/ExpandedPostDetail';
import { RejectionModal } from '@/components/queue/RejectionModal';
import { scorePostEngagement, type EngagementPrediction } from '@/lib/generation/engagement-scorer';

interface QueuePost extends Post {
  queuePriority: number;
}

interface QueueResponse {
  posts: QueuePost[];
  total: number;
  hasMore: boolean;
}

type ConfidenceLevel = 'high' | 'medium' | 'low';

function getConfidenceLevel(score: number): ConfidenceLevel {
  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

function getConfidenceBadgeStyles(level: ConfidenceLevel): string {
  switch (level) {
    case 'high':
      return 'bg-green-500/20 text-green-400 border-green-500/50';
    case 'medium':
      return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50';
    case 'low':
      return 'bg-red-500/20 text-red-400 border-red-500/50';
  }
}

interface PostCardProps {
  post: QueuePost;
  isSelected: boolean;
  onSelect: () => void;
  onApprove: () => void;
  onReject: () => void;
  onEdit: () => void;
}

function PostCard({
  post,
  isSelected,
  onSelect,
  onApprove,
  onReject,
  onEdit,
}: PostCardProps): React.ReactElement {
  const confidenceLevel = getConfidenceLevel(post.confidenceScore);
  const preview = post.content.length > 120 ? post.content.substring(0, 120) + '...' : post.content;
  const engagement = scorePostEngagement(post.content);

  return (
    <div
      onClick={onSelect}
      className={`rounded-lg border p-4 cursor-pointer transition-all ${
        isSelected
          ? 'border-blue-500 bg-gray-800/80 ring-1 ring-blue-500/50'
          : 'border-gray-700 bg-gray-800 hover:border-gray-600'
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-gray-200 text-sm leading-relaxed">{preview}</p>
          <div className="flex items-center gap-3 mt-3 flex-wrap">
            <span
              className={`px-2 py-0.5 text-xs font-medium rounded border ${getConfidenceBadgeStyles(confidenceLevel)}`}
            >
              {Math.round(post.confidenceScore)}%
            </span>
            <EngagementBadge engagement={engagement} />
            <span className="text-xs text-gray-500 capitalize">{post.type}</span>
            <span className="text-xs text-gray-600">{formatTimeAgo(post.createdAt)}</span>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <ActionButton
            label="A"
            title="Approve"
            onClick={(e) => {
              e.stopPropagation();
              onApprove();
            }}
            variant="approve"
          />
          <ActionButton
            label="R"
            title="Reject"
            onClick={(e) => {
              e.stopPropagation();
              onReject();
            }}
            variant="reject"
          />
          <ActionButton
            label="E"
            title="Edit"
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            variant="edit"
          />
        </div>
      </div>
    </div>
  );
}

interface ActionButtonProps {
  label: string;
  title: string;
  onClick: (e: React.MouseEvent) => void;
  variant: 'approve' | 'reject' | 'edit';
}

function ActionButton({ label, title, onClick, variant }: ActionButtonProps): React.ReactElement {
  const variantStyles = {
    approve: 'hover:bg-green-500/20 hover:text-green-400 hover:border-green-500/50',
    reject: 'hover:bg-red-500/20 hover:text-red-400 hover:border-red-500/50',
    edit: 'hover:bg-blue-500/20 hover:text-blue-400 hover:border-blue-500/50',
  };

  return (
    <button
      onClick={onClick}
      title={title}
      className={`w-8 h-8 flex items-center justify-center text-xs font-medium rounded border border-gray-600 text-gray-400 transition-colors ${variantStyles[variant]}`}
    >
      {label}
    </button>
  );
}

interface EngagementBadgeProps {
  engagement: EngagementPrediction;
}

function EngagementBadge({ engagement }: EngagementBadgeProps): React.ReactElement {
  const scoreColor =
    engagement.overallScore >= 7
      ? 'text-green-400'
      : engagement.overallScore >= 5
        ? 'text-yellow-400'
        : 'text-red-400';

  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs rounded bg-gray-700/50 border border-gray-600"
      title={`Engagement prediction: Likes ${engagement.predictedLikes}/10, Replies ${engagement.predictedReplies}/10, Reposts ${engagement.predictedReposts}/10${engagement.suggestions.length > 0 ? '\n\nTips: ' + engagement.suggestions.join(', ') : ''}`}
    >
      <span className="text-red-400" title="Predicted Likes">
        ❤️{engagement.predictedLikes}
      </span>
      <span className="text-blue-400" title="Predicted Replies">
        💬{engagement.predictedReplies}
      </span>
      <span className="text-green-400" title="Predicted Reposts">
        🔁{engagement.predictedReposts}
      </span>
      <span className={`font-medium ${scoreColor}`}>{engagement.overallScore}/10</span>
    </span>
  );
}

function formatTimeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

const POSTS_PER_PAGE = 5;

export default function QueuePage(): React.ReactElement {
  const [posts, setPosts] = useState<QueuePost[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const [expandedPost, setExpandedPost] = useState<QueuePost | null>(null);
  const [rejectingPost, setRejectingPost] = useState<QueuePost | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  const fetchQueue = useCallback(async (): Promise<void> => {
    try {
      const limit = showAll ? 50 : POSTS_PER_PAGE;
      const response = await fetch(`/api/queue?limit=${limit}`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = (await response.json()) as QueueResponse;
      setPosts(data.posts);
      setTotal(data.total);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch queue');
    } finally {
      setIsLoading(false);
    }
  }, [showAll]);

  useEffect(() => {
    void fetchQueue();
  }, [fetchQueue]);

  const handleApprove = useCallback(
    async (post: QueuePost, starred = false): Promise<void> => {
      try {
        const response = await fetch(`/api/posts/${post.id}/approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ starred }),
        });
        if (!response.ok) throw new Error('Failed to approve');
        setExpandedPost(null);
        await fetchQueue();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to approve post');
      }
    },
    [fetchQueue]
  );

  const openRejectModal = useCallback((post: QueuePost): void => {
    setRejectingPost(post);
  }, []);

  const handleRejectConfirm = useCallback(
    async (reason: string, comment?: string): Promise<void> => {
      if (!rejectingPost) return;
      try {
        const response = await fetch(`/api/posts/${rejectingPost.id}/reject`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason, comment }),
        });
        if (!response.ok) throw new Error('Failed to reject');
        setRejectingPost(null);
        setExpandedPost(null);
        await fetchQueue();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to reject post');
      }
    },
    [rejectingPost, fetchQueue]
  );

  const handleRejectCancel = useCallback((): void => {
    setRejectingPost(null);
  }, []);

  const handleEdit = useCallback((post: QueuePost): void => {
    setExpandedPost(post);
  }, []);

  const handleEditSave = useCallback(
    async (
      post: QueuePost,
      newContent: string,
      _diffBefore: string,
      _diffAfter: string
    ): Promise<void> => {
      try {
        const response = await fetch(`/api/posts/${post.id}/edit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: newContent }),
        });
        if (!response.ok) throw new Error('Failed to save edit');
        setExpandedPost(null);
        await fetchQueue();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save edit');
      }
    },
    [fetchQueue]
  );

  const handleCloseModal = useCallback((): void => {
    setExpandedPost(null);
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      // Don't handle keyboard when modal is open or typing in input
      if (expandedPost !== null || rejectingPost !== null) {
        return;
      }
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      const currentPost = posts[selectedIndex];

      switch (e.key.toLowerCase()) {
        case 'j':
          e.preventDefault();
          setSelectedIndex((prev) => Math.min(prev + 1, posts.length - 1));
          break;
        case 'k':
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case 'a':
          e.preventDefault();
          if (currentPost !== undefined) void handleApprove(currentPost);
          break;
        case 'r':
          e.preventDefault();
          if (currentPost !== undefined) openRejectModal(currentPost);
          break;
        case 'e':
          e.preventDefault();
          if (currentPost !== undefined) handleEdit(currentPost);
          break;
        case 'enter':
          e.preventDefault();
          if (currentPost !== undefined) setExpandedPost(currentPost);
          break;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return (): void => window.removeEventListener('keydown', handleKeyDown);
  }, [
    posts,
    selectedIndex,
    expandedPost,
    rejectingPost,
    handleApprove,
    openRejectModal,
    handleEdit,
  ]);

  useEffect(() => {
    if (selectedIndex >= posts.length && posts.length > 0) {
      setSelectedIndex(posts.length - 1);
    }
  }, [posts.length, selectedIndex]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">Loading queue...</div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Review Queue</h1>
          <p className="text-sm text-gray-400 mt-1">
            {total} post{total !== 1 ? 's' : ''} awaiting review
          </p>
        </div>
        <div className="flex items-center gap-4">
          <KeyboardHint />
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-900/20 border border-red-500/50 p-4">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {posts.length === 0 ? (
        <div className="rounded-lg bg-gray-800 p-8 text-center">
          <p className="text-gray-400">No posts in queue.</p>
          <p className="text-gray-500 text-sm mt-2">
            The agent will generate new content based on your sources.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {posts.map((post, index) => (
            <PostCard
              key={post.id}
              post={post}
              isSelected={index === selectedIndex}
              onSelect={() => setSelectedIndex(index)}
              onApprove={() => void handleApprove(post)}
              onReject={() => openRejectModal(post)}
              onEdit={() => handleEdit(post)}
            />
          ))}
        </div>
      )}

      {!showAll && total > POSTS_PER_PAGE && (
        <div className="text-center">
          <button
            onClick={() => setShowAll(true)}
            className="text-blue-400 hover:text-blue-300 text-sm font-medium transition-colors"
          >
            View all {total} posts →
          </button>
        </div>
      )}

      {expandedPost && (
        <ExpandedPostDetail
          post={expandedPost}
          onApprove={(starred) => void handleApprove(expandedPost, starred)}
          onReject={() => openRejectModal(expandedPost)}
          onEdit={(newContent, diffBefore, diffAfter) =>
            void handleEditSave(expandedPost, newContent, diffBefore, diffAfter)
          }
          onClose={handleCloseModal}
        />
      )}

      {rejectingPost && (
        <RejectionModal
          isOpen={rejectingPost !== null}
          postId={rejectingPost.id}
          onConfirm={(reason, comment) => void handleRejectConfirm(reason, comment)}
          onCancel={handleRejectCancel}
        />
      )}
    </div>
  );
}

function KeyboardHint(): React.ReactElement {
  return (
    <div className="flex items-center gap-3 text-xs text-gray-500">
      <span>
        <kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-gray-400">j</kbd>
        <kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-gray-400 ml-1">k</kbd>
        <span className="ml-1">navigate</span>
      </span>
      <span>
        <kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-gray-400">Enter</kbd>
        <span className="ml-1">expand</span>
      </span>
      <span>
        <kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-gray-400">a</kbd>
        <span className="ml-1">approve</span>
      </span>
      <span>
        <kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-gray-400">r</kbd>
        <span className="ml-1">reject</span>
      </span>
      <span>
        <kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-gray-400">e</kbd>
        <span className="ml-1">edit</span>
      </span>
    </div>
  );
}
