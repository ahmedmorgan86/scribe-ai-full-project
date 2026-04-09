# Database Schema Documentation

This document describes the SQLite database schema for ai-social-engine.

## Overview

The application uses SQLite (via better-sqlite3) for structured data and Qdrant for vector embeddings.

**SQLite Database:** `./data/ai-social-engine.db` (configurable via `SQLITE_DB_PATH`)
**Qdrant:** `http://localhost:6333` (configurable via `QDRANT_URL`)

---

## Tables

### posts

Stores generated content with status tracking and evaluation results.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT | Unique identifier |
| content | TEXT | NOT NULL | The generated post content |
| type | TEXT | NOT NULL, CHECK | Post type: `single`, `thread`, `quote`, `reply` |
| status | TEXT | NOT NULL, DEFAULT 'draft', CHECK | Status: `draft`, `pending`, `approved`, `rejected`, `posted` |
| confidence_score | REAL | NOT NULL, DEFAULT 0 | Overall confidence score (0-100) |
| reasoning | TEXT | NOT NULL, DEFAULT '{}' | JSON object with generation reasoning |
| voice_evaluation | TEXT | | JSON object with voice evaluation results |
| stylometric_signature | TEXT | | JSON object with stylometric metrics |
| langgraph_job_id | TEXT | | LangGraph pipeline job ID for tracing |
| created_at | TEXT | NOT NULL, DEFAULT datetime('now') | Creation timestamp |
| posted_at | TEXT | | When content was posted (manual) |
| copied_at | TEXT | | When content was copied for posting |

**Indexes:**
- `idx_posts_status` on status
- `idx_posts_created_at` on created_at
- `idx_posts_copied_at` on copied_at

**Reasoning JSON Structure:**
```json
{
  "source": "Description of source material",
  "whyItWorks": "Why this content should perform well",
  "voiceMatch": "How it matches the voice guidelines",
  "timing": "Timing considerations",
  "concerns": ["Array of potential concerns"]
}
```

**Voice Evaluation JSON Structure:**
```json
{
  "passed": true,
  "score": {
    "voice": 85,
    "hook": 80,
    "topic": 75,
    "originality": 70,
    "overall": 78
  },
  "failureReasons": [],
  "strengths": ["Array of strengths"],
  "suggestions": ["Array of suggestions"],
  "stoppedAt": "llm_eval",
  "costUsd": 0.001,
  "evaluatedAt": "2024-01-15T10:30:00Z"
}
```

---

### feedback

Stores user feedback on generated posts for learning.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT | Unique identifier |
| post_id | INTEGER | NOT NULL, FOREIGN KEY | Reference to posts.id |
| action | TEXT | NOT NULL, CHECK | Action: `approve`, `reject`, `edit` |
| category | TEXT | CHECK | Rejection category: `generic`, `tone`, `hook`, `value`, `topic`, `timing`, `other` |
| comment | TEXT | | Optional user comment |
| diff_before | TEXT | | Original content before edit |
| diff_after | TEXT | | Content after edit |
| created_at | TEXT | NOT NULL, DEFAULT datetime('now') | Feedback timestamp |

**Indexes:**
- `idx_feedback_post_id` on post_id
- `idx_feedback_action` on action
- `idx_feedback_created_at` on created_at

**Foreign Keys:**
- `post_id` REFERENCES `posts(id)` ON DELETE CASCADE

---

### patterns

Stores learned patterns extracted from user feedback.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT | Unique identifier |
| pattern_type | TEXT | NOT NULL, CHECK | Type: `voice`, `hook`, `topic`, `rejection`, `edit` |
| description | TEXT | NOT NULL | Human-readable pattern description |
| evidence_count | INTEGER | NOT NULL, DEFAULT 0 | Total evidence supporting pattern |
| edit_evidence_count | INTEGER | NOT NULL, DEFAULT 0 | Evidence from edits (weighted 3x) |
| rejection_evidence_count | INTEGER | NOT NULL, DEFAULT 0 | Evidence from rejections (weighted 1x) |
| created_at | TEXT | NOT NULL, DEFAULT datetime('now') | Creation timestamp |
| updated_at | TEXT | NOT NULL, DEFAULT datetime('now') | Last update timestamp |

**Indexes:**
- `idx_patterns_pattern_type` on pattern_type
- `idx_patterns_evidence_count` on evidence_count
- `idx_patterns_edit_evidence` on edit_evidence_count

**Pattern Weighting:**
- Edit-based evidence is weighted 3x (`PATTERN_WEIGHT_EDIT = 3`)
- Rejection-based evidence is weighted 1x (`PATTERN_WEIGHT_REJECTION = 1`)
- Weighted score = `edit_evidence_count * 3 + rejection_evidence_count * 1`

---

### queue

Manages the content review queue with priority ordering.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT | Unique identifier |
| post_id | INTEGER | NOT NULL, UNIQUE, FOREIGN KEY | Reference to posts.id |
| priority | INTEGER | NOT NULL, DEFAULT 0 | Priority (higher = more urgent) |
| scheduled_for | TEXT | | Optional scheduled review time |
| created_at | TEXT | NOT NULL, DEFAULT datetime('now') | Queue entry timestamp |

**Indexes:**
- `idx_queue_priority` on priority DESC
- `idx_queue_scheduled_for` on scheduled_for
- `idx_queue_post_id` on post_id

**Foreign Keys:**
- `post_id` REFERENCES `posts(id)` ON DELETE CASCADE

---

### sources

Stores scraped content from Smaug (likes/bookmarks) and Apify (account tweets).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT | Unique identifier |
| source_type | TEXT | NOT NULL, CHECK | Type: `like`, `bookmark`, `account_tweet` |
| source_id | TEXT | NOT NULL | External ID (Twitter tweet ID) |
| content | TEXT | NOT NULL | Tweet content |
| metadata | TEXT | NOT NULL, DEFAULT '{}' | JSON with additional data |
| scraped_at | TEXT | NOT NULL, DEFAULT datetime('now') | Scrape timestamp |

**Indexes:**
- `idx_sources_source_id` UNIQUE on (source_type, source_id)
- `idx_sources_type` on source_type
- `idx_sources_scraped_at` on scraped_at

**Metadata JSON Structure:**
```json
{
  "authorHandle": "@username",
  "authorName": "Display Name",
  "likeCount": 100,
  "retweetCount": 50,
  "url": "https://twitter.com/...",
  "originalCreatedAt": "2024-01-15T10:30:00Z"
}
```

---

### accounts

Tracks the 200 curated Twitter accounts for scraping.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT | Unique identifier |
| handle | TEXT | NOT NULL, UNIQUE | Twitter handle (without @) |
| tier | INTEGER | NOT NULL, CHECK | Tier: `1` (top 20, 30min), `2` (rest, 2-4hr) |
| last_scraped | TEXT | | Last successful scrape timestamp |
| health_status | TEXT | NOT NULL, DEFAULT 'healthy', CHECK | Status: `healthy`, `degraded`, `failing` |

**Indexes:**
- `idx_accounts_tier` on tier
- `idx_accounts_health_status` on health_status
- `idx_accounts_last_scraped` on last_scraped

**Health Status Transitions:**
- `healthy` → `degraded`: After 2 consecutive failures
- `degraded` → `failing`: After 5 consecutive failures
- Accounts with `failing` status are skipped during scraping

---

### formulas

Stores content generation formulas with usage tracking.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT | Unique identifier |
| name | TEXT | NOT NULL, UNIQUE | Formula name |
| template | TEXT | NOT NULL | Formula template/instructions |
| usage_count | INTEGER | NOT NULL, DEFAULT 0 | Times formula was used |
| success_rate | REAL | NOT NULL, DEFAULT 0 | Approval rate (0-1) |
| active | INTEGER | NOT NULL, DEFAULT 1, CHECK | Active flag: `0` or `1` |

**Indexes:**
- `idx_formulas_active` on active
- `idx_formulas_success_rate` on success_rate DESC

**Starter Formulas:**
1. Problem → AI Solution
2. Hidden Gem Discovery
3. Hidden Gem Discovery
4. Simplifier
5. The Bridge

---

### cost_tracking

Logs API costs for budget management.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT | Unique identifier |
| api_name | TEXT | NOT NULL, CHECK | API: `anthropic`, `apify`, `smaug`, `openai`, `litellm` |
| model_id | TEXT | | Model identifier (e.g., `claude-sonnet-4`, `gpt-4o`) |
| tokens_used | INTEGER | NOT NULL, DEFAULT 0 | Tokens consumed |
| cost_usd | REAL | NOT NULL, DEFAULT 0 | Cost in USD |
| created_at | TEXT | NOT NULL, DEFAULT datetime('now') | Log timestamp |

**Indexes:**
- `idx_cost_tracking_api_name` on api_name
- `idx_cost_tracking_created_at` on created_at

---

### rules

Stores explicit rules derived from clarification resolutions.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT | Unique identifier |
| rule_type | TEXT | NOT NULL, CHECK | Type: `voice`, `hook`, `topic`, `style`, `format`, `general` |
| description | TEXT | NOT NULL | Rule description |
| source | TEXT | NOT NULL, CHECK | Source: `clarification`, `manual`, `bootstrap` |
| source_contradiction_id | INTEGER | | Reference to resolved contradiction |
| priority | INTEGER | NOT NULL, DEFAULT 1 | Priority (higher = more important) |
| is_active | INTEGER | NOT NULL, DEFAULT 1, CHECK | Active flag: `0` or `1` |
| context | TEXT | | Optional context/notes |
| created_at | TEXT | NOT NULL, DEFAULT datetime('now') | Creation timestamp |
| updated_at | TEXT | NOT NULL, DEFAULT datetime('now') | Last update timestamp |

**Indexes:**
- `idx_rules_rule_type` on rule_type
- `idx_rules_is_active` on is_active
- `idx_rules_priority` on priority DESC
- `idx_rules_source` on source

---

## Qdrant Collections

In addition to SQLite, the application uses Qdrant for vector embeddings with hybrid search (dense + sparse vectors).

### approved_posts
Stores embeddings of approved posts for voice similarity matching.
- **Vector size:** 1536 (OpenAI) or 1024 (Cohere)
- **Sparse vectors:** Enabled (TF-IDF based)
- **Quantization:** Scalar (for cost savings)
- **Default similarity threshold:** 70%
- **Payload fields:** `post_id`, `created_at`, `voice_score`, `content_type`, `is_exceptional`

### voice_guidelines
Stores embeddings of voice guidelines (DOs, DON'Ts, examples, rules).
- **Vector size:** 1536 (OpenAI) or 1024 (Cohere)
- **Sparse vectors:** Enabled
- **Payload fields:** `guideline_type`, `category`, `priority`, `created_at`

### sources
Stores embeddings of scraped content for deduplication.
- **Vector size:** 1536 (OpenAI) or 1024 (Cohere)
- **Sparse vectors:** Enabled (for hybrid deduplication)
- **Quantization:** Scalar
- **Payload fields:** `source_type`, `source_id`, `author`, `scraped_at`
- **Default similarity threshold:** 85%

### ai_slop_corpus
Stores embeddings of known AI-generated "slop" content for detection.
- **Vector size:** 1536 (OpenAI) or 1024 (Cohere)
- **Sparse vectors:** Enabled
- **Quantization:** Scalar
- **Payload fields:** `source`, `category`, `added_at`
- **Default similarity threshold:** 85%

---

## Migration System

Migrations are located in `/src/db/migrations/` and use a registry-based approach:

- Migrations register via `registerMigration()`
- Applied migrations tracked in `_migrations` table
- Run with `runMigrations()`, rollback with `rollbackMigration()`
- Each migration has `up()` and `down()` functions

**Migration Naming:** `XXX_description.ts` (e.g., `001_create_posts_table.ts`)

---

## Entity Relationships

```
posts ─────┬───── feedback (1:many)
           └───── queue (1:1)

patterns (standalone, populated from feedback analysis)

sources (standalone, populated by workers)

accounts (standalone, managed via bootstrap)

formulas (standalone, seeded at startup)

cost_tracking (standalone, write-only log)

rules (standalone, created from contradiction resolution)
```
