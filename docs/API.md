# API Routes Documentation

This document describes all API routes available in ai-social-engine.

**Base URL:** `http://localhost:3000/api`

---

## Table of Contents

- [Posts](#posts)
- [Queue](#queue)
- [Patterns](#patterns)
- [Feedback](#feedback)
- [Stats](#stats)
- [Generate](#generate)
- [Settings](#settings)
- [Export](#export)
- [Notifications](#notifications)
- [Knowledge Base](#knowledge-base)
- [Costs](#costs)
- [Errors](#errors)
- [Bootstrap](#bootstrap)
- [Dashboard](#dashboard)

---

## Posts

### GET /api/posts

List all posts with pagination and filtering.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| status | string | - | Filter by status: `draft`, `pending`, `approved`, `rejected`, `posted` |
| limit | number | 50 | Results per page (1-100) |
| offset | number | 0 | Skip N results |
| orderBy | string | `created_at` | Sort by: `created_at`, `confidence_score` |
| orderDir | string | `desc` | Sort direction: `asc`, `desc` |

**Response:**
```json
{
  "posts": [
    {
      "id": 1,
      "content": "Post content...",
      "type": "single",
      "status": "pending",
      "confidenceScore": 85,
      "reasoning": { "source": "...", "whyItWorks": "..." },
      "voiceEvaluation": { "passed": true, "score": {...} },
      "createdAt": "2026-01-15T10:00:00Z",
      "postedAt": null
    }
  ],
  "total": 100,
  "hasMore": true
}
```

### POST /api/posts

Create a new post.

**Request Body:**
```json
{
  "content": "Post content (required)",
  "type": "single",
  "status": "draft",
  "confidenceScore": 85,
  "reasoning": {
    "source": "Source description",
    "whyItWorks": "Explanation",
    "voiceMatch": 85,
    "timing": "evergreen",
    "concerns": []
  }
}
```

**Required Fields:**
- `content` (string): Post content
- `type` (string): `single`, `thread`, `quote`, `reply`

**Response:** `201 Created` with the created Post object

---

### GET /api/posts/[id]

Get a single post by ID.

**Response:** Post object or `404 Not Found`

---

### PATCH /api/posts/[id]

Update a post.

**Request Body:** Partial Post object (all fields optional)
```json
{
  "content": "Updated content",
  "status": "approved",
  "confidenceScore": 90
}
```

**Response:** Updated Post object

---

### DELETE /api/posts/[id]

Delete a post.

**Response:**
```json
{ "success": true }
```

---

### POST /api/posts/[id]/approve

Approve a post. Updates status, creates feedback entry, removes from queue, adds to voice corpus.

**Request Body (optional):**
```json
{
  "isExceptional": true,
  "comment": "Great hook!",
  "voiceScore": 90
}
```

**Response:**
```json
{
  "post": { ... },
  "feedbackId": 42,
  "addedToVoiceCorpus": true
}
```

---

### POST /api/posts/[id]/reject

Reject a post. Updates status, creates feedback entry, removes from queue.

**Request Body (required):**
```json
{
  "category": "tone",
  "comment": "Too formal"
}
```

**Categories:** `generic`, `tone`, `hook`, `value`, `topic`, `timing`, `other`

**Response:**
```json
{
  "post": { ... },
  "feedbackId": 43
}
```

---

### POST /api/posts/[id]/edit

Edit a post and capture the diff for learning.

**Request Body:**
```json
{
  "content": "Edited content",
  "comment": "Made it more concise"
}
```

**Response:**
```json
{
  "post": { ... },
  "feedbackId": 44,
  "diffCaptured": true
}
```

---

### POST /api/posts/[id]/copy

Record when content is copied for manual posting.

**Response:**
```json
{
  "postId": 1,
  "copiedAt": "2026-01-15T10:30:00Z"
}
```

---

## Queue

### GET /api/queue

Get pending posts ordered by priority and confidence.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| limit | number | 5 | Results per page (1-100) |
| offset | number | 0 | Skip N results |

**Response:**
```json
{
  "posts": [
    {
      "id": 1,
      "content": "...",
      "queuePriority": 10,
      "confidenceScore": 85,
      ...
    }
  ],
  "total": 25,
  "hasMore": true
}
```

---

### POST /api/queue

Add a post to queue or update its priority.

**Request Body:**
```json
{
  "postId": 1,
  "priority": 10
}
```

**Response:**
```json
{
  "item": { "id": 1, "postId": 1, "priority": 10, ... },
  "created": true
}
```

---

## Patterns

### GET /api/patterns

List learned patterns.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| patternType | string | - | Filter by type: `voice`, `hook`, `topic`, `rejection`, `edit` |
| minEvidenceCount | number | - | Minimum evidence count |
| limit | number | 50 | Results per page (1-100) |
| offset | number | 0 | Skip N results |
| orderBy | string | `evidence_count` | Sort by: `created_at`, `updated_at`, `evidence_count` |
| orderDir | string | `desc` | Sort direction: `asc`, `desc` |

**Response:**
```json
{
  "patterns": [
    {
      "id": 1,
      "patternType": "voice",
      "description": "Use problem-first hooks",
      "evidenceCount": 15,
      "editEvidenceCount": 10,
      "rejectionEvidenceCount": 5,
      "createdAt": "...",
      "updatedAt": "..."
    }
  ],
  "total": 50,
  "hasMore": false
}
```

---

### DELETE /api/patterns

Batch delete patterns.

**Request Body:**
```json
{
  "ids": [1, 2, 3]
}
```

**Response:**
```json
{
  "success": true,
  "deletedCount": 3
}
```

---

### GET /api/patterns/[id]

Get a single pattern by ID.

---

### PATCH /api/patterns/[id]

Update a pattern's description.

**Request Body:**
```json
{
  "description": "Updated pattern description"
}
```

---

### DELETE /api/patterns/[id]

Delete a single pattern.

**Response:**
```json
{ "success": true }
```

---

## Feedback

### GET /api/feedback

List feedback history.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| postId | number | - | Filter by post ID |
| action | string | - | Filter by action: `approve`, `reject`, `edit` |
| category | string | - | Filter by category |
| limit | number | 50 | Results per page (1-100) |
| offset | number | 0 | Skip N results |
| orderDir | string | `desc` | Sort direction: `asc`, `desc` |

**Response:**
```json
{
  "feedback": [
    {
      "id": 1,
      "postId": 42,
      "action": "reject",
      "category": "tone",
      "comment": "Too formal",
      "diffBefore": null,
      "diffAfter": null,
      "createdAt": "..."
    }
  ],
  "total": 200,
  "hasMore": true
}
```

---

## Stats

### GET /api/stats

Get comprehensive dashboard statistics.

**Response:**
```json
{
  "queue": {
    "pendingCount": 25,
    "draftCount": 10,
    "approvedTodayCount": 15
  },
  "posts": {
    "totalCount": 500,
    "approvedCount": 300,
    "rejectedCount": 150,
    "postsToday": 20
  },
  "feedback": {
    "totalCount": 450,
    "approvalRate7d": 72,
    "approvalRate30d": 68,
    "trend": "up",
    "trendDelta": 5
  },
  "patterns": {
    "totalCount": 50,
    "voicePatterns": 20,
    "rejectionPatterns": 15,
    "editPatterns": 15
  },
  "sources": {
    "totalCount": 1000,
    "likesCount": 500,
    "bookmarksCount": 200,
    "accountTweetsCount": 300
  },
  "accounts": {
    "totalCount": 200,
    "healthyCount": 180,
    "degradedCount": 15,
    "failingCount": 5
  },
  "costs": {
    "todayUsd": 2.50,
    "monthUsd": 45.00,
    "budgetLimitUsd": 100,
    "budgetUsedPercent": 45
  },
  "timestamp": "2026-01-15T12:00:00Z"
}
```

---

## Generate

### POST /api/generate

Generate content from a source.

**Request Body:**
```json
{
  "sourceId": 1,
  "postType": "single",
  "forceFormula": "problem-solution",
  "skipVoiceValidation": false,
  "skipSlopDetection": false,
  "skipQuoteValueCheck": false,
  "skipDuplicateCheck": false,
  "maxRewriteAttempts": 2,
  "addToQueue": true,
  "queuePriority": 5
}
```

**Required Fields:**
- `sourceId` (number): ID of the source to generate from

**Response:** `201 Created`
```json
{
  "post": { ... },
  "generationDetails": {
    "success": true,
    "failureReason": null,
    "formula": "problem-solution",
    "totalCostUsd": 0.05,
    "rewriteCount": 1,
    "flagForHumanReview": false,
    "voiceScore": 82,
    "slopDetected": false,
    "slopDetectors": []
  },
  "addedToQueue": true,
  "source": {
    "id": 1,
    "sourceId": "tweet-123",
    "sourceType": "like"
  }
}
```

**Error Codes:**
- `INVALID_REQUEST` (400): Invalid request body
- `SOURCE_NOT_FOUND` (404): Source ID not found
- `BUDGET_EXCEEDED` (402): API budget exceeded
- `GENERATION_ERROR` (500): Generation failed

---

## Settings

### GET /api/settings

Get current application settings.

**Response:**
```json
{
  "notificationVerbosity": "summary",
  "notificationPreferences": {
    "verbosity": "summary",
    "enabledTypes": {
      "content_ready": true,
      "time_sensitive": true,
      "agent_stuck": true,
      "budget_warning": true
    }
  },
  "budgetLimits": {
    "anthropicDailyUsd": 10,
    "anthropicMonthlyUsd": 100,
    "apifyMonthlyUsd": 50
  },
  "budgetStatus": [
    { "apiName": "anthropic", "period": "daily", "used": 5, "limit": 10, ... }
  ],
  "voiceExamples": [ ... ],
  "dataSourceConfig": {
    "smaugEnabled": true,
    "smaugPollIntervalMinutes": 5,
    "apifyEnabled": true,
    "apifyTier1IntervalMinutes": 30,
    "apifyTier2IntervalMinutes": 120
  }
}
```

---

### PATCH /api/settings

Update settings (validation only - requires server restart for runtime changes).

**Request Body (all fields optional):**
```json
{
  "notificationVerbosity": "rich",
  "anthropicDailyUsd": 15,
  "anthropicMonthlyUsd": 150,
  "apifyMonthlyUsd": 75,
  "smaugEnabled": true,
  "smaugPollIntervalMinutes": 10,
  "apifyTier1IntervalMinutes": 45,
  "apifyTier2IntervalMinutes": 180
}
```

**Response:**
```json
{
  "success": true,
  "message": "Settings validated. Note: Runtime settings changes require updating environment variables and restarting the server."
}
```

---

## Export

### GET /api/export

Export all data as JSON or CSV.

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| format | string | Yes | `json` or `csv` |

**Response:** File download with appropriate content type

---

## Notifications

### GET /api/notifications/test

Check Discord notification configuration status.

**Response:**
```json
{
  "configured": true,
  "types": ["content_ready", "time_sensitive", "agent_stuck", "budget_warning"]
}
```

---

### POST /api/notifications/test

Send a test notification.

**Request Body:**
```json
{
  "type": "content_ready",
  "payload": {
    "queueCount": 5,
    "highConfidenceCount": 3
  }
}
```

**Types:** `content_ready`, `time_sensitive`, `agent_stuck`, `budget_warning`

**Response:**
```json
{
  "success": true,
  "type": "content_ready",
  "message": "Test content_ready notification sent successfully"
}
```

---

## Knowledge Base

### GET /api/knowledge

Get the full knowledge base summary.

**Response:**
```json
{
  "patterns": [
    {
      "id": 1,
      "type": "voice",
      "description": "...",
      "evidenceCount": 15,
      "editEvidenceCount": 10,
      "rejectionEvidenceCount": 5,
      "weightedScore": 35,
      "createdAt": "...",
      "updatedAt": "..."
    }
  ],
  "stats": {
    "total": 50,
    "byType": { "voice": 20, "hook": 10, "topic": 8, "rejection": 7, "edit": 5 },
    "highConfidence": 30,
    "lowConfidence": 5,
    "avgEvidenceCount": 8.5,
    "totalEditEvidence": 200,
    "totalRejectionEvidence": 100,
    "avgWeightedScore": 15.5
  },
  "contradictions": [
    {
      "patternA": { "id": 1, "description": "...", "evidenceCount": 10 },
      "patternB": { "id": 2, "description": "...", "evidenceCount": 8 },
      "contradictionType": "direct_opposite",
      "severity": "high",
      "explanation": "..."
    }
  ],
  "feedbackStats": {
    "total": 450,
    "approvals": 300,
    "rejections": 100,
    "edits": 50
  },
  "sourceAccounts": [
    { "handle": "techinfluencer", "tier": 1, "contribution": 50 }
  ]
}
```

---

## Costs

### GET /api/costs

Get cost breakdown by API.

**Response:**
```json
{
  "byApi": [
    {
      "apiName": "anthropic",
      "dailyCost": 2.50,
      "monthlyCost": 45.00,
      "dailyLimit": 10,
      "monthlyLimit": 100,
      "dailyRemaining": 7.50,
      "monthlyRemaining": 55.00,
      "dailyPercentUsed": 25,
      "monthlyPercentUsed": 45
    }
  ],
  "totalDailyCost": 3.00,
  "totalMonthlyCost": 50.00,
  "timestamp": "2026-01-15T12:00:00Z"
}
```

---

## Errors

### GET /api/errors/summary

Get error summary and API health status.

**Response:**
```json
{
  "apiHealth": [
    {
      "name": "anthropic",
      "status": "healthy",
      "consecutiveFailures": 0,
      "totalFailures": 5,
      "lastSuccess": "2026-01-15T12:00:00Z",
      "lastFailure": "2026-01-14T10:00:00Z",
      "lastError": "Rate limit exceeded"
    }
  ],
  "recentErrors": [
    {
      "id": "anthropic-2026-01-14T10:00:00Z",
      "source": "anthropic",
      "message": "Rate limit exceeded",
      "timestamp": "2026-01-14T10:00:00Z",
      "category": "rate_limit",
      "retryable": true
    }
  ],
  "errorCounts": {
    "last1h": 0,
    "last24h": 2,
    "last7d": 10,
    "bySource": { "anthropic": 5, "apify": 3, "chroma": 2 },
    "byCategory": { "rate_limit": 5, "network": 3, "server": 2 }
  },
  "timestamp": "2026-01-15T12:00:00Z"
}
```

---

## Bootstrap

Bootstrap endpoints for initial system setup.

### GET /api/bootstrap/status

Check bootstrap status and missing requirements.

**Response:**
```json
{
  "voiceGuidelinesLoaded": true,
  "approvedPostsCount": 45,
  "hasMinimumCorpus": false,
  "accountsCount": 200,
  "formulasCount": 5,
  "hasActiveFormula": true,
  "apiKeysConfigured": {
    "anthropic": true,
    "smaug": true,
    "apify": true
  },
  "discordWebhookConfigured": true,
  "isReady": false,
  "missingRequirements": [
    "Need 5 more approved posts (45/50)"
  ]
}
```

---

### POST /api/bootstrap/voice-guidelines

Upload voice guidelines.

**Request Body:**
```json
{
  "content": "## DO's\n- Use problem-first hooks\n..."
}
```

**Response:**
```json
{
  "success": true,
  "parsed": {
    "dosCount": 10,
    "dontsCount": 8,
    "examplesCount": 5,
    "rulesCount": 3
  }
}
```

---

### POST /api/bootstrap/gold-examples

Add gold example posts for voice training.

**Request Body:**
```json
{
  "examples": [
    "Example tweet 1...",
    "Example tweet 2..."
  ]
}
```

**Response:**
```json
{
  "success": true,
  "added": 20,
  "skipped": 0
}
```

---

### POST /api/bootstrap/accounts

Upload accounts list for scraping.

**Request Body:**
```json
{
  "accounts": [
    "@techinfluencer,1",
    "sama,1",
    "levelsio,2"
  ]
}
```

Format: `handle,tier` (tier is optional, defaults to 2)

**Response:**
```json
{
  "success": true,
  "added": 200,
  "skipped": 5
}
```

---

### POST /api/bootstrap/api-keys

Configure API keys.

**Request Body:**
```json
{
  "anthropicApiKey": "sk-ant-...",
  "smaugApiUrl": "https://smaug.example.com",
  "smaugApiKey": "...",
  "apifyApiToken": "apify_api_..."
}
```

**Response:**
```json
{
  "success": true,
  "configured": {
    "anthropic": true,
    "smaug": true,
    "apify": true
  }
}
```

---

### POST /api/bootstrap/discord-webhook

Configure Discord webhook URL.

**Request Body:**
```json
{
  "webhookUrl": "https://discord.com/api/webhooks/..."
}
```

**Response:**
```json
{
  "success": true
}
```

---

## Dashboard

### GET /api/dashboard/stats

Get dashboard-specific statistics for the home view.

**Response:**
```json
{
  "agentActivity": {
    "status": "idle",
    "currentTask": null,
    "lastActivity": null,
    "progress": null,
    "subTasks": []
  },
  "queueSummary": {
    "pendingCount": 25,
    "draftCount": 10,
    "approvedTodayCount": 15
  },
  "quickStats": {
    "postsToday": 20,
    "approvalRate7d": 72,
    "approvalRate30d": 68,
    "trend": "up",
    "trendDelta": 5
  },
  "alerts": [
    {
      "id": "budget-warning",
      "type": "warning",
      "title": "Budget Warning",
      "message": "Anthropic budget at 85% of monthly limit",
      "timestamp": "...",
      "source": "budget",
      "action": { "label": "View Settings", "href": "/settings" }
    }
  ],
  "timestamp": "2026-01-15T12:00:00Z"
}
```

**Agent Status Types:** `idle`, `generating`, `analyzing`, `learning`, `error`

**Alert Types:** `info`, `warning`, `error`, `success`

**Alert Sources:** `generation`, `budget`, `scraping`, `system`

---

## Error Responses

All endpoints return errors in this format:

```json
{
  "error": "Error message",
  "code": "ERROR_CODE"
}
```

**Common HTTP Status Codes:**
- `400` - Bad Request (invalid parameters)
- `402` - Payment Required (budget exceeded)
- `404` - Not Found
- `500` - Internal Server Error
- `502` - Bad Gateway (external API failure)
- `503` - Service Unavailable (feature not configured)
