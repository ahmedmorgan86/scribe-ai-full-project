# AI Social Engine - API Reference

This document describes all API endpoints and their response formats for backwards compatibility.

**Version:** 1.0
**Base URL:** `/api`

---

## Table of Contents

- [Posts](#posts)
- [Queue](#queue)
- [Generate](#generate)
- [Feedback](#feedback)
- [Patterns](#patterns)
- [Stats](#stats)
- [Settings](#settings)
- [Export](#export)
- [Costs](#costs)
- [Bootstrap](#bootstrap)
- [Notifications](#notifications)
- [Knowledge Base](#knowledge-base)
- [LLM Health](#llm-health)
- [Workers Health](#workers-health)
- [Stylometric](#stylometric)
- [LangGraph](#langgraph)

---

## Common Types

### Post
```typescript
interface Post {
  id: number;
  content: string;
  type: 'single' | 'thread' | 'quote' | 'reply';
  status: 'draft' | 'pending' | 'approved' | 'rejected' | 'posted';
  confidenceScore: number;
  reasoning: PostReasoning;
  voiceEvaluation: StoredVoiceEvaluation | null;
  stylometricSignature: StyleSignatureData | null;
  createdAt: string;
  postedAt: string | null;
  copiedAt: string | null;
  langGraphJobId: string | null;
}

interface PostReasoning {
  source: string;
  whyItWorks: string;
  voiceMatch: number;
  timing: string;
  concerns: string[];
}
```

### Feedback
```typescript
interface Feedback {
  id: number;
  postId: number;
  action: 'approve' | 'reject' | 'edit';
  category: 'generic' | 'tone' | 'hook' | 'value' | 'topic' | 'timing' | 'other' | null;
  comment: string | null;
  diffBefore: string | null;
  diffAfter: string | null;
  createdAt: string;
}
```

### Pattern
```typescript
interface Pattern {
  id: number;
  patternType: 'voice' | 'hook' | 'topic' | 'rejection' | 'edit';
  description: string;
  evidenceCount: number;
  editEvidenceCount: number;
  rejectionEvidenceCount: number;
  createdAt: string;
  updatedAt: string;
}
```

### ErrorResponse
```typescript
interface ErrorResponse {
  error: string;
  code?: string;
}
```

---

## Posts

### GET /api/posts
List posts with pagination and filtering.

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| status | string | - | Filter by status: draft, pending, approved, rejected, posted |
| limit | number | 50 | Max 100 |
| offset | number | 0 | Pagination offset |
| orderBy | string | created_at | Sort field: created_at, confidence_score |
| orderDir | string | desc | Sort direction: asc, desc |

**Response:**
```typescript
interface ListPostsResponse {
  posts: Post[];
  total: number;
  hasMore: boolean;
}
```

### POST /api/posts
Create a new post.

**Request Body:**
```typescript
interface CreatePostBody {
  content: string;          // Required
  type: PostType;           // Required
  status?: PostStatus;
  confidenceScore?: number; // 0-100
  reasoning?: {
    source?: string;
    whyItWorks?: string;
    voiceMatch?: number;
    timing?: string;
    concerns?: string[];
  };
}
```

**Response:** `Post` (status 201)

### GET /api/posts/[id]
Get a single post by ID.

**Response:** `Post`

### PATCH /api/posts/[id]
Update a post.

**Request Body:**
```typescript
interface UpdatePostBody {
  content?: string;
  type?: PostType;
  status?: PostStatus;
  confidenceScore?: number;
  reasoning?: PostReasoning;
  postedAt?: string | null;
}
```

**Response:** `Post`

### DELETE /api/posts/[id]
Delete a post.

**Response:**
```typescript
{ success: boolean }
```

### POST /api/posts/[id]/approve
Approve a post.

**Request Body:**
```typescript
interface ApproveBody {
  isExceptional?: boolean;
  comment?: string;
  voiceScore?: number; // 0-100
}
```

**Response:**
```typescript
interface ApproveResponse {
  post: Post;
  feedbackId: number;
  addedToVoiceCorpus: boolean;
  addedToQdrant?: boolean;
}
```

### POST /api/posts/[id]/reject
Reject a post with a category.

**Request Body:**
```typescript
interface RejectBody {
  category: 'generic' | 'tone' | 'hook' | 'value' | 'topic' | 'timing' | 'other'; // Required
  comment?: string;
}
```

**Response:**
```typescript
interface RejectResponse {
  post: Post;
  feedbackId: number;
}
```

### POST /api/posts/[id]/edit
Edit a post's content.

**Request Body:**
```typescript
interface EditBody {
  content: string; // Required
  comment?: string;
}
```

**Response:**
```typescript
interface EditResponse {
  post: Post;
  feedbackId: number;
  diffCaptured: boolean;
}
```

### POST /api/posts/[id]/copy
Record that a post was copied for manual posting.

**Response:**
```typescript
interface CopyResponse {
  postId: number;
  copiedAt: string | null;
}
```

---

## Queue

### GET /api/queue
Get pending posts for review queue.

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| limit | number | 5 | Max 100 |
| offset | number | 0 | Pagination offset |

**Response:**
```typescript
interface QueueResponse {
  posts: QueuePost[];  // Post with queuePriority field
  total: number;
  hasMore: boolean;
}

interface QueuePost extends Post {
  queuePriority: number;
}
```

### POST /api/queue
Reorder queue item priority.

**Request Body:**
```typescript
interface ReorderBody {
  postId: number;   // Required
  priority: number; // Required
}
```

**Response:**
```typescript
interface ReorderResponse {
  item: QueueItem;
  created: boolean;
}

interface QueueItem {
  id: number;
  postId: number;
  priority: number;
  scheduledFor: string | null;
  createdAt: string;
}
```

---

## Generate

### POST /api/generate
Generate content from a source.

**Request Body:**
```typescript
interface GenerateRequestBody {
  sourceId: number;              // Required
  postType?: PostType;
  forceFormula?: string;
  skipVoiceValidation?: boolean;
  skipSlopDetection?: boolean;
  skipQuoteValueCheck?: boolean;
  skipDuplicateCheck?: boolean;
  maxRewriteAttempts?: number;   // 0-5
  addToQueue?: boolean;
  queuePriority?: number;
  useLangGraph?: boolean;        // Use LangGraph pipeline
  debug?: boolean;               // Include debug trace
}
```

**Response:**
```typescript
interface GenerateSuccessResponse {
  post: Post;
  generationDetails: {
    success: boolean;
    failureReason: string | null;
    formula: string | null;
    totalCostUsd: number;
    rewriteCount: number;
    flagForHumanReview: boolean;
    voiceScore: number | null;
    slopDetected: boolean;
    slopDetectors: string[];
  };
  addedToQueue: boolean;
  source: {
    id: number;
    sourceId: string;
    sourceType: string;
  };
  pipeline: 'legacy' | 'langgraph';
  langGraphJobId?: string;
  debugTrace?: DebugTraceEntry[];
}

interface DebugTraceEntry {
  node: string;
  message?: string;
  timestamp?: string;
  duration_ms?: number;
}
```

**Error Codes:**
- `INVALID_REQUEST` (400)
- `SOURCE_NOT_FOUND` (404)
- `BUDGET_EXCEEDED` (402)
- `GENERATION_ERROR` (500)

---

## Feedback

### GET /api/feedback
List feedback entries.

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| postId | number | - | Filter by post ID |
| action | string | - | Filter by action: approve, reject, edit |
| category | string | - | Filter by category |
| limit | number | 50 | Max 100 |
| offset | number | 0 | Pagination offset |
| orderDir | string | desc | Sort direction |

**Response:**
```typescript
interface ListFeedbackResponse {
  feedback: Feedback[];
  total: number;
  hasMore: boolean;
}
```

---

## Patterns

### GET /api/patterns
List learned patterns.

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| patternType | string | - | Filter by type: voice, hook, topic, rejection, edit |
| minEvidenceCount | number | - | Minimum evidence count |
| limit | number | 50 | Max 100 |
| offset | number | 0 | Pagination offset |
| orderBy | string | evidence_count | Sort field: created_at, updated_at, evidence_count |
| orderDir | string | desc | Sort direction |

**Response:**
```typescript
interface ListPatternsResponse {
  patterns: Pattern[];
  total: number;
  hasMore: boolean;
}
```

### DELETE /api/patterns
Delete multiple patterns.

**Request Body:**
```typescript
interface DeleteBody {
  ids: number[]; // Max 100
}
```

**Response:**
```typescript
interface DeleteResponse {
  success: boolean;
  deletedCount: number;
}
```

---

## Stats

### GET /api/stats
Get dashboard statistics.

**Response:**
```typescript
interface StatsResponse {
  queue: {
    pendingCount: number;
    draftCount: number;
    approvedTodayCount: number;
  };
  posts: {
    totalCount: number;
    approvedCount: number;
    rejectedCount: number;
    postsToday: number;
  };
  feedback: {
    totalCount: number;
    approvalRate7d: number;
    approvalRate30d: number;
    trend: 'up' | 'down' | 'stable';
    trendDelta: number;
  };
  patterns: {
    totalCount: number;
    voicePatterns: number;
    rejectionPatterns: number;
    editPatterns: number;
  };
  sources: {
    totalCount: number;
    likesCount: number;
    bookmarksCount: number;
    accountTweetsCount: number;
  };
  accounts: {
    totalCount: number;
    healthyCount: number;
    degradedCount: number;
    failingCount: number;
  };
  costs: {
    todayUsd: number;
    monthUsd: number;
    budgetLimitUsd: number | null;
    budgetUsedPercent: number | null;
  };
  timestamp: string;
}
```

---

## Settings

### GET /api/settings
Get current settings.

**Response:**
```typescript
interface SettingsResponse {
  notificationVerbosity: 'minimal' | 'summary' | 'rich';
  notificationPreferences: {
    verbosity: 'minimal' | 'summary' | 'rich';
    enabledTypes: {
      content_ready: boolean;
      time_sensitive: boolean;
      agent_stuck: boolean;
      budget_warning: boolean;
    };
  };
  budgetLimits: {
    anthropicDailyUsd: number;
    anthropicMonthlyUsd: number;
    apifyMonthlyUsd: number;
  };
  budgetStatus: BudgetStatus[];
  voiceExamples: VoiceExampleResponse[];
  dataSourceConfig: {
    smaugEnabled: boolean;
    smaugPollIntervalMinutes: number;
    apifyEnabled: boolean;
    apifyTier1IntervalMinutes: number;
    apifyTier2IntervalMinutes: number;
  };
}

interface BudgetStatus {
  apiName: string;
  period: string;
  limit: number;
  used: number;
  percentage: number;
  exceeded: boolean;
}

interface VoiceExampleResponse {
  id: string;
  content: string;
  createdAt: string;
}
```

### PATCH /api/settings
Validate settings update (runtime changes require server restart).

**Request Body:**
```typescript
interface PatchSettingsBody {
  notificationVerbosity?: 'minimal' | 'summary' | 'rich';
  notifyContentReady?: boolean;
  notifyTimeSensitive?: boolean;
  notifyAgentStuck?: boolean;
  notifyBudgetWarning?: boolean;
  anthropicDailyUsd?: number;
  anthropicMonthlyUsd?: number;
  apifyMonthlyUsd?: number;
  smaugEnabled?: boolean;
  smaugPollIntervalMinutes?: number;   // 1-60
  apifyEnabled?: boolean;
  apifyTier1IntervalMinutes?: number;  // 15-180
  apifyTier2IntervalMinutes?: number;  // 60-480
}
```

**Response:**
```typescript
{ success: boolean; message: string }
```

---

## Export

### GET /api/export
Export all data.

**Query Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| format | string | Yes | Output format: json, csv |

**Response:** File download (JSON or CSV)

**JSON Response Schema:**
```typescript
interface ExportData {
  exportedAt: string;
  version: string;
  posts: Post[];
  feedback: Feedback[];
  patterns: Pattern[];
  costHistory: CostEntry[];
}

interface CostEntry {
  id: number;
  apiName: 'anthropic' | 'apify' | 'smaug' | 'openai' | 'litellm';
  modelId: string | null;
  tokensUsed: number;
  costUsd: number;
  createdAt: string;
}
```

---

## Costs

### GET /api/costs
Get cost tracking summary by API.

**Response:**
```typescript
interface CostsApiResponse {
  byApi: {
    apiName: string;
    dailyCost: number;
    monthlyCost: number;
    dailyLimit?: number;
    monthlyLimit?: number;
    dailyRemaining?: number;
    monthlyRemaining?: number;
    dailyPercentUsed?: number;
    monthlyPercentUsed?: number;
  }[];
  totalDailyCost: number;
  totalMonthlyCost: number;
  timestamp: string;
}
```

---

## Bootstrap

### GET /api/bootstrap/status
Get bootstrap/readiness status.

**Response:**
```typescript
interface BootstrapStatus {
  voiceGuidelinesLoaded: boolean;
  approvedPostsCount: number;
  hasMinimumCorpus: boolean;
  accountsCount: number;
  formulasCount: number;
  hasActiveFormula: boolean;
  apiKeysConfigured: {
    anthropic: boolean;
    smaug: boolean;
    apify: boolean;
  };
  discordWebhookConfigured: boolean;
  isReady: boolean;
  missingRequirements: string[];
}
```

---

## Notifications

### GET /api/notifications/test
Check Discord configuration status.

**Response:**
```typescript
{
  configured: boolean;
  types: string[];  // ['content_ready', 'time_sensitive', 'agent_stuck', 'budget_warning']
}
```

### POST /api/notifications/test
Send a test Discord notification.

**Request Body:**
```typescript
interface TestRequestBody {
  type: 'content_ready' | 'time_sensitive' | 'agent_stuck' | 'budget_warning';
  payload?: object; // Optional override for notification payload
}
```

**Response:**
```typescript
interface TestSuccessResponse {
  success: boolean;
  type: string;
  message: string;
}
```

**Error Codes:**
- `DISCORD_NOT_CONFIGURED` (503)
- `INVALID_REQUEST` (400)
- `SEND_FAILED` (502)

---

## Knowledge Base

### GET /api/knowledge
Get comprehensive knowledge base data (patterns, contradictions, feedback stats).

**Response:**
```typescript
interface KnowledgeBaseResponse {
  patterns: StoredPatternResponse[];
  stats: PatternStatsResponse;
  contradictions: ContradictionResponse[];
  feedbackStats: FeedbackStatsResponse;
  sourceAccounts: SourceAccountResponse[];
}

interface StoredPatternResponse {
  id: number;
  type: 'voice' | 'hook' | 'topic' | 'rejection' | 'edit';
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
```

---

## LLM Health

### GET /api/llm/health
Check LLM provider availability.

**Response:**
```typescript
interface LLMHealthResponse {
  status: 'healthy' | 'degraded' | 'unavailable';
  gatewayEnabled: boolean;
  gatewayReachable: boolean;
  gatewayUrl: string;
  providers: ProviderStatus[];
  availableModels: string[];
  timestamp: string;
}

interface ProviderStatus {
  name: string;
  available: boolean;
  models: string[];
  configuredViaEnv: boolean;
}
```

---

## Workers Health

### GET /api/workers/health
Check Python worker services status.

**Response:**
```typescript
interface WorkerStatusResponse {
  status: 'healthy' | 'degraded' | 'unavailable';
  services: {
    litellm: WorkerHealth;
    langgraph: WorkerHealth;
    stylometry: WorkerHealth;
  };
  urls: {
    litellm: string;
    langgraph: string;
    stylometry: string;
  };
}

interface WorkerHealth {
  available: boolean;
  status: 'healthy' | 'degraded' | 'unavailable';
  latencyMs: number | null;
  error: string | null;
}
```

---

## Stylometric

### POST /api/stylometric/validate
Validate content against stylometric signature.

**Request Body:**
```typescript
interface StylometricValidateRequest {
  content: string;    // Required
  threshold?: number; // Default: 0.7
}
```

**Response:**
```typescript
interface StylometricValidateResponse {
  success: boolean;
  result: StylometricValidationResult | null;
  error: string | null;
}

interface StylometricValidationResult {
  pass: boolean;
  score: number;
  threshold: number;
  dimensionScores: {
    sentenceLength: number;
    punctuation: number;
    vocabulary: number;
    functionWords: number;
    syntactic: number;
  };
  feedback: string;
  detailedFeedback: string[];
}
```

### GET /api/stylometric/drift
Check for stylometric drift from baseline.

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| threshold | number | 0.15 | Drift threshold (0.0-1.0) |
| count | number | 20 | Recent posts to analyze |
| notify | boolean | true | Send Discord notification if drift detected |

**Response:**
```typescript
interface DriftCheckResponse {
  hasDrift: boolean;
  driftPercentage: number;       // 0.0-1.0
  threshold: number;
  recentPostsCount: number;
  recentSignature: StyleSignatureData | null;
  baselineSignature: StyleSignatureData | null;
  dimensionDrifts: Record<string, number> | null;  // Per-dimension drift values
  feedback: string[];            // Actionable improvement suggestions
  alertLevel: 'none' | 'warning' | 'critical';
  checkedAt: string;             // ISO timestamp
  notificationSent: boolean;
}
```

### GET /api/analytics/stylometric
Get stylometric analytics and trends.

**Response:**
```typescript
interface StylometricAnalyticsResponse {
  trends: {
    sentenceLength: TimeSeriesPoint[];
    vocabularyRichness: TimeSeriesPoint[];
    punctuation: {
      period: TimeSeriesPoint[];
      comma: TimeSeriesPoint[];
      exclamation: TimeSeriesPoint[];
      question: TimeSeriesPoint[];
    };
  };
  current: {
    avgSentenceLength: number | null;
    avgVocabularyRichness: number | null;
    avgPunctuationPeriod: number | null;
    avgPunctuationComma: number | null;
    avgPunctuationExclamation: number | null;
    avgPunctuationQuestion: number | null;
    sampleCount: number;
  };
  baseline: {
    sentenceLength: { current: number | null; baseline: number | null; diff: number | null };
    vocabularyRichness: { current: number | null; baseline: number | null; diff: number | null };
    punctuationPeriod: { current: number | null; baseline: number | null; diff: number | null };
  };
  voiceHealth: {
    status: 'healthy' | 'warning' | 'critical' | 'unknown';
    score: number;
    driftPercentage: number;
    threshold: number;
    issues: string[];
  };
  postsWithSignatures: number;
  totalApprovedPosts: number;
}

interface TimeSeriesPoint {
  date: string;
  value: number;
}
```

---

## LangGraph

### GET /api/langgraph/health
Check LangGraph worker availability.

**Response:**
```typescript
interface LangGraphHealthResponse {
  available: boolean;
  status: 'healthy' | 'degraded' | 'unavailable';
  latencyMs: number | null;
}
```

### GET /api/langgraph/jobs
List recent generation jobs.

**Response:**
```typescript
interface JobsResponse {
  jobs: JobInfo[];
}

interface JobInfo {
  id: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  contentType: string;
  sourcesCount: number;
  createdAt: string;
  completedAt: string | null;
  durationMs: number | null;
}
```

### GET /api/langgraph/debug/[jobId]
Get debug trace for a generation job.

**Response:**
```typescript
interface DebugTraceResponse {
  found: boolean;
  jobId: string;
  jobInfo: JobInfo | null;
  checkpoints: CheckpointInfo[];
  trace: DebugTraceEntry[];
}

interface CheckpointInfo {
  id: string;
  threadId: string;
  timestamp: string;
  node: string;
}

interface DebugTraceEntry {
  node: string;
  message?: string;
  timestamp?: string;
  duration_ms?: number;
}
```

---

## HTTP Status Codes

| Code | Description |
|------|-------------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request - Invalid input |
| 402 | Payment Required - Budget exceeded |
| 404 | Not Found |
| 500 | Internal Server Error |

---

## Changelog

### v1.0.1 (Phase 1.5 - Migration Checklist)
- Added missing endpoints: /api/posts/[id]/copy, /api/costs, /api/notifications/test, /api/knowledge
- Updated /api/stylometric/drift with full response schema
- Added Notifications and Knowledge Base sections to table of contents

### v1.0 (Phase 1.5)
- Initial API documentation
- Added LangGraph pipeline support
- Added stylometric validation endpoints
- Added multi-provider LLM health checks
- Added Python workers health endpoint
