// Core database entity types

export type PostStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'posted';
export type PostType = 'single' | 'thread' | 'quote' | 'reply';

export interface Post {
  id: number;
  content: string;
  type: PostType;
  status: PostStatus;
  confidenceScore: number;
  reasoning: PostReasoning;
  voiceEvaluation: StoredVoiceEvaluation | null;
  stylometricSignature: StyleSignatureData | null;
  createdAt: string;
  postedAt: string | null;
  copiedAt: string | null;
  langGraphJobId: string | null;
  rejectionReason: string | null;
  rejectionComment: string | null;
  rejectedAt: string | null;
}

export interface StyleSignatureData {
  sentenceLength: {
    mean: number;
    stdDev: number;
  };
  punctuation: {
    periodRate: number;
    commaRate: number;
    exclamationRate: number;
    questionRate: number;
    dashRate: number;
    ellipsisRate: number;
  };
  vocabulary: {
    typeTokenRatio: number;
    hapaxRatio: number;
  };
  functionWords: {
    the: number;
    and: number;
    but: number;
    of: number;
    to: number;
    a: number;
    in: number;
    that: number;
    is: number;
    it: number;
  };
  syntactic: {
    avgClauseDepth: number;
    avgWordsPerClause: number;
    subordinateClauseRatio: number;
  };
  metadata?: {
    textLength: number;
    sampleCount: number;
    generatedAt: string;
  };
}

export interface PostReasoning {
  source: string;
  whyItWorks: string;
  voiceMatch: number;
  timing: string;
  concerns: string[];
}

export type FeedbackAction = 'approve' | 'reject' | 'edit';
export type FeedbackCategory = 'generic' | 'tone' | 'hook' | 'value' | 'topic' | 'timing' | 'other';

export interface Feedback {
  id: number;
  postId: number;
  action: FeedbackAction;
  category: FeedbackCategory | null;
  comment: string | null;
  diffBefore: string | null;
  diffAfter: string | null;
  createdAt: string;
}

export type PatternType = 'voice' | 'hook' | 'topic' | 'rejection' | 'edit';

export type PatternStatus = 'active' | 'superseded' | 'archived';

export type PatternEvidenceSource = 'edit' | 'rejection' | 'approval';

export interface Pattern {
  id: number;
  patternType: PatternType;
  description: string;
  evidenceCount: number;
  editEvidenceCount: number;
  rejectionEvidenceCount: number;
  lastAccessedAt: string | null;
  accessCount: number;
  decayScore: number;
  status: PatternStatus;
  createdAt: string;
  updatedAt: string;
}

export const PATTERN_WEIGHT_EDIT = 3;
export const PATTERN_WEIGHT_REJECTION = 1;

export type RuleType = 'voice' | 'hook' | 'topic' | 'style' | 'format' | 'general';
export type RuleSource = 'clarification' | 'manual' | 'bootstrap';

export interface Rule {
  id: number;
  ruleType: RuleType;
  description: string;
  source: RuleSource;
  sourceContradictionId: number | null;
  priority: number;
  isActive: boolean;
  context: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QueueItem {
  id: number;
  postId: number;
  priority: number;
  scheduledFor: string | null;
  createdAt: string;
}

export type SourceType = 'like' | 'bookmark' | 'account_tweet';

export interface Source {
  id: number;
  sourceType: SourceType;
  sourceId: string;
  content: string;
  metadata: SourceMetadata;
  scrapedAt: string;
}

export interface SourceMetadata {
  authorHandle?: string;
  authorName?: string;
  likeCount?: number;
  retweetCount?: number;
  url?: string;
  processedAt?: string;
  processingFailed?: boolean;
  processingError?: string;
  retryCount?: number;
}

export type AccountTier = 1 | 2;
export type AccountHealthStatus = 'healthy' | 'degraded' | 'failing';

export interface Account {
  id: number;
  handle: string;
  tier: AccountTier;
  lastScraped: string | null;
  healthStatus: AccountHealthStatus;
}

export interface Formula {
  id: number;
  name: string;
  template: string;
  usageCount: number;
  successRate: number;
  active: boolean;
}

export type ApiName = 'anthropic' | 'apify' | 'smaug' | 'openai' | 'litellm';

export interface CostEntry {
  id: number;
  apiName: ApiName;
  modelId: string | null;
  tokensUsed: number;
  costUsd: number;
  createdAt: string;
}

// Voice system types

export interface VoiceScore {
  voice: number;
  hook: number;
  topic: number;
  originality: number;
  overall: number;
}

export interface VoiceEvaluation {
  passed: boolean;
  score: VoiceScore;
  failureReasons: string[];
}

export interface StoredVoiceEvaluation {
  passed: boolean;
  score: VoiceScore;
  failureReasons: string[];
  strengths: string[];
  suggestions: string[];
  stoppedAt: 'fast_filter' | 'llm_eval';
  costUsd: number;
  evaluatedAt: string;
}

// Slop detection types

export interface SlopResult {
  isSlop: boolean;
  detectedBy: SlopDetector[];
  flagForReview: boolean;
}

export type SlopDetector = 'phrase' | 'structural' | 'semantic' | 'voice-contrast' | 'humanizer';

// Content generation types

export interface GenerationResult {
  post: Omit<Post, 'id' | 'createdAt' | 'postedAt'>;
  voiceEvaluation: VoiceEvaluation;
  slopResult: SlopResult;
}

export interface ThreadTweet {
  position: number;
  content: string;
}

export interface Thread {
  tweets: ThreadTweet[];
  totalLength: number;
}

// Notification types

export type NotificationVerbosity = 'minimal' | 'summary' | 'rich';
export type NotificationType =
  | 'content_ready'
  | 'time_sensitive'
  | 'agent_stuck'
  | 'budget_warning';

export interface NotificationPreferences {
  verbosity: NotificationVerbosity;
  enabledTypes: {
    content_ready: boolean;
    time_sensitive: boolean;
    agent_stuck: boolean;
    budget_warning: boolean;
  };
}

export interface Notification {
  type: NotificationType;
  title: string;
  message: string;
  urgency: 'low' | 'medium' | 'high';
}

// API request/response types

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

// Anthropic model types

export type AnthropicModel = 'haiku' | 'sonnet' | 'opus';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

// Settings types

export interface AppSettings {
  notificationVerbosity: NotificationVerbosity;
  notificationPreferences: NotificationPreferences;
  anthropicDailyBudgetUsd: number;
  anthropicMonthlyBudgetUsd: number;
  apifyMonthlyBudgetUsd: number;
}

// Generation job tracking types

export type GenerationJobPipeline = 'langgraph' | 'typescript';
export type GenerationJobStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface GenerationJob {
  id: string;
  pipeline: GenerationJobPipeline;
  status: GenerationJobStatus;
  sourceIds: number[] | null;
  postId: number | null;
  contentType: string | null;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
  metadata: Record<string, unknown> | null;
}
