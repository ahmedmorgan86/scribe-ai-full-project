'use client';

import { useCallback, useEffect, useState } from 'react';
import { Post } from '@/types';
import {
  parseThreadContent,
  isThread,
  formatCopiedAt,
  ThreadTweet,
} from '@/lib/copy/clipboard-client';

interface ApprovedPost extends Post {
  copiedAt: string | null;
}

interface CopyState {
  [postId: number]:
    | { type: 'single'; copied: boolean }
    | { type: 'thread'; copiedIndices: Set<number>; allCopied: boolean };
}

export default function PostsReadyPage(): React.ReactElement {
  const [posts, setPosts] = useState<ApprovedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<CopyState>({});
  const [filter, setFilter] = useState<'all' | 'not_copied'>('all');

  const fetchApprovedPosts = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/posts?status=approved&limit=100');
      if (!res.ok) throw new Error('Failed to fetch posts');
      const data = (await res.json()) as { posts: ApprovedPost[] };
      setPosts(data.posts);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load posts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchApprovedPosts();
  }, [fetchApprovedPosts]);

  const handleCopySingle = useCallback(async (post: ApprovedPost): Promise<void> => {
    try {
      await navigator.clipboard.writeText(post.content);
      await fetch(`/api/posts/${post.id}/copy`, { method: 'POST' });

      setCopyState((prev) => ({
        ...prev,
        [post.id]: { type: 'single', copied: true },
      }));

      setPosts((prev) =>
        prev.map((p) => (p.id === post.id ? { ...p, copiedAt: new Date().toISOString() } : p))
      );

      setTimeout(() => {
        setCopyState((prev) => ({
          ...prev,
          [post.id]: { type: 'single', copied: false },
        }));
      }, 2000);
    } catch {
      // Silent fail
    }
  }, []);

  const handleCopyThreadTweet = useCallback(
    async (post: ApprovedPost, tweet: ThreadTweet): Promise<void> => {
      try {
        await navigator.clipboard.writeText(tweet.content);

        const currentState = copyState[post.id];
        const copiedIndices =
          currentState?.type === 'thread' ? new Set(currentState.copiedIndices) : new Set<number>();

        copiedIndices.add(tweet.position);

        const tweets = parseThreadContent(post.content);
        const allCopied = tweets.every((t) => copiedIndices.has(t.position));

        if (allCopied) {
          await fetch(`/api/posts/${post.id}/copy`, { method: 'POST' });
          setPosts((prev) =>
            prev.map((p) => (p.id === post.id ? { ...p, copiedAt: new Date().toISOString() } : p))
          );
        }

        setCopyState((prev) => ({
          ...prev,
          [post.id]: { type: 'thread', copiedIndices, allCopied },
        }));
      } catch {
        // Silent fail
      }
    },
    [copyState]
  );

  const handleCopyAllThread = useCallback(async (post: ApprovedPost): Promise<void> => {
    try {
      await navigator.clipboard.writeText(post.content);
      await fetch(`/api/posts/${post.id}/copy`, { method: 'POST' });

      const tweets = parseThreadContent(post.content);

      setCopyState((prev) => ({
        ...prev,
        [post.id]: {
          type: 'thread',
          copiedIndices: new Set(tweets.map((t) => t.position)),
          allCopied: true,
        },
      }));

      setPosts((prev) =>
        prev.map((p) => (p.id === post.id ? { ...p, copiedAt: new Date().toISOString() } : p))
      );
    } catch {
      // Silent fail
    }
  }, []);

  const handleCopySingleSync = useCallback(
    (post: ApprovedPost): void => {
      void handleCopySingle(post);
    },
    [handleCopySingle]
  );

  const handleCopyThreadTweetSync = useCallback(
    (post: ApprovedPost, tweet: ThreadTweet): void => {
      void handleCopyThreadTweet(post, tweet);
    },
    [handleCopyThreadTweet]
  );

  const handleCopyAllThreadSync = useCallback(
    (post: ApprovedPost): void => {
      void handleCopyAllThread(post);
    },
    [handleCopyAllThread]
  );

  const filteredPosts = filter === 'not_copied' ? posts.filter((p) => !p.copiedAt) : posts;
  const notCopiedCount = posts.filter((p) => !p.copiedAt).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">Loading approved posts...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-red-400">{error}</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Posts Ready</h1>
          <p className="text-gray-400 mt-1">
            {posts.length} approved posts ({notCopiedCount} not yet copied)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filter === 'all'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            All
          </button>
          <button
            onClick={() => setFilter('not_copied')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filter === 'not_copied'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            Not Copied ({notCopiedCount})
          </button>
        </div>
      </div>

      {filteredPosts.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-400">
            {filter === 'not_copied' ? 'All posts have been copied!' : 'No approved posts yet.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredPosts.map((post) => (
            <PostReadyCard
              key={post.id}
              post={post}
              copyState={copyState[post.id]}
              onCopySingle={() => handleCopySingleSync(post)}
              onCopyThreadTweet={(tweet) => handleCopyThreadTweetSync(post, tweet)}
              onCopyAllThread={() => handleCopyAllThreadSync(post)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface PostReadyCardProps {
  post: ApprovedPost;
  copyState: CopyState[number] | undefined;
  onCopySingle: () => void;
  onCopyThreadTweet: (tweet: ThreadTweet) => void;
  onCopyAllThread: () => void;
}

function PostReadyCard({
  post,
  copyState,
  onCopySingle,
  onCopyThreadTweet,
  onCopyAllThread,
}: PostReadyCardProps): React.ReactElement {
  const isThreadPost = isThread(post.type);
  const tweets = isThreadPost ? parseThreadContent(post.content) : [];

  const isSingleCopied = copyState?.type === 'single' && copyState.copied;
  const isThreadAllCopied = copyState?.type === 'thread' && copyState.allCopied;
  const copiedIndices = copyState?.type === 'thread' ? copyState.copiedIndices : new Set<number>();

  return (
    <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
      <div className="p-4 border-b border-gray-700 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span
            className={`px-2 py-1 rounded text-xs font-medium ${
              post.type === 'thread'
                ? 'bg-purple-500/20 text-purple-400 border border-purple-500/50'
                : post.type === 'quote'
                  ? 'bg-orange-500/20 text-orange-400 border border-orange-500/50'
                  : post.type === 'reply'
                    ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/50'
                    : 'bg-blue-500/20 text-blue-400 border border-blue-500/50'
            }`}
          >
            {post.type}
          </span>
          <span className="text-xs text-gray-500">{formatCopiedAt(post.copiedAt)}</span>
        </div>
        {!isThreadPost && (
          <button
            onClick={onCopySingle}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              isSingleCopied
                ? 'bg-green-600 text-white'
                : 'bg-blue-600 hover:bg-blue-500 text-white'
            }`}
          >
            {isSingleCopied ? (
              <>
                <CheckIcon />
                Copied!
              </>
            ) : (
              <>
                <CopyIcon />
                Copy
              </>
            )}
          </button>
        )}
        {isThreadPost && (
          <button
            onClick={onCopyAllThread}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              isThreadAllCopied
                ? 'bg-green-600 text-white'
                : 'bg-blue-600 hover:bg-blue-500 text-white'
            }`}
          >
            {isThreadAllCopied ? (
              <>
                <CheckIcon />
                All Copied!
              </>
            ) : (
              <>
                <CopyIcon />
                Copy All ({tweets.length})
              </>
            )}
          </button>
        )}
      </div>

      <div className="p-4">
        {isThreadPost ? (
          <div className="space-y-3">
            {tweets.map((tweet) => {
              const isCopied = copiedIndices.has(tweet.position);
              return (
                <div
                  key={tweet.position}
                  className={`flex items-start gap-4 p-3 rounded-lg border ${
                    isCopied
                      ? 'bg-green-900/20 border-green-500/30'
                      : 'bg-gray-900/50 border-gray-700'
                  }`}
                >
                  <div className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-gray-700 text-gray-400 text-sm font-medium">
                    {tweet.position}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm whitespace-pre-wrap">{tweet.content}</p>
                  </div>
                  <button
                    onClick={() => onCopyThreadTweet(tweet)}
                    className={`flex-shrink-0 p-2 rounded-lg transition-colors ${
                      isCopied
                        ? 'bg-green-600 text-white'
                        : 'bg-gray-700 hover:bg-gray-600 text-gray-400 hover:text-white'
                    }`}
                    title={isCopied ? 'Copied!' : `Copy tweet ${tweet.position}`}
                  >
                    {isCopied ? <CheckIcon /> : <CopyIcon />}
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-white whitespace-pre-wrap">{post.content}</p>
        )}
      </div>
    </div>
  );
}

function CopyIcon(): React.ReactElement {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
      />
    </svg>
  );
}

function CheckIcon(): React.ReactElement {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  );
}
