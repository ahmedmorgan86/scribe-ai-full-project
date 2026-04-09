# Slop Detection System

How ai-social-engine identifies and eliminates AI-generated phrases and patterns.

## What is "Slop"?

"Slop" refers to common AI-generated phrases, patterns, and stylistic tics that make content sound obviously machine-written. Examples:

- "Let's dive in" / "Let's unpack this"
- "Game-changer" / "Mind-blowing"
- "In this thread..."
- "Here's the thing..."
- Excessive use of em dashes
- Lists that always have exactly 5 items

## Detection Architecture

Slop detection operates at multiple levels:

```
Generated Text
     │
     ▼
┌─────────────────┐
│  Phrase Blacklist │ ← 120+ banned phrases
│   (< 5ms)        │
└────────┬────────┘
         │ Pass
         ▼
┌─────────────────┐
│  Structural      │ ← Pattern detection (sentence structure, formatting)
│  Analysis        │
└────────┬────────┘
         │ Pass
         ▼
┌─────────────────┐
│  Voice Contrast  │ ← Compares against voice profile
│  Check           │
└────────┬────────┘
         │ Pass
         ▼
     Clean Output
```

## Layer 1: Phrase Blacklist

Fast regex-based matching against a curated list of 120+ AI-typical phrases.

### Categories

| Category | Examples | Count |
|----------|----------|-------|
| AI Conversation Starters | "let's dive in", "let's explore", "let's break this down" | 7 |
| Generic Openers | "here's the thing", "here's why", "the thing is" | 5 |
| Hype Words | "game-changer", "revolutionary", "groundbreaking" | 9 |
| Thread Announcements | "in this thread", "thread:", "a thread" | 4 |
| Clickbait | "hot take:", "unpopular opinion:", "you won't believe" | 4 |
| Filler Phrases | "at the end of the day", "needless to say", "real talk" | 14 |
| Pseudo-Insider | "here's a secret", "most people don't know", "pro tip:" | 8 |
| Corporate Speak | "secret sauce", "synergy", "paradigm shift", "deep dive" | 14 |
| Filler Transitional | "that being said", "having said that", "moving on" | 7 |
| Performative | "i firmly believe", "in my humble opinion" | 6 |
| Generic Conclusions | "food for thought", "let that sink in" | 5 |

### Implementation

```typescript
// src/lib/slop/phrase-blacklist.ts
export const BANNED_PHRASES = [
  "let's dive in",
  "game-changer",
  "mind-blowing",
  // ... 120+ more
] as const;
```

The blacklist uses normalized text matching (lowercase, normalized quotes and whitespace) with position tracking for precise feedback.

### Customization

The phrase list is defined in `src/lib/slop/phrase-blacklist.ts`. A reference copy is maintained in `config/slop-words.json`.

To add custom phrases:
1. Edit `src/lib/slop/phrase-blacklist.ts`
2. Add to the `BANNED_PHRASES` array
3. Rebuild and restart

## Layer 2: Structural Analysis

Detects AI-typical structural patterns that aren't individual phrases:

### Patterns Detected

- **List uniformity** — AI tends to generate lists where all items have similar length
- **Excessive structure** — Too many headings, bullets, or numbered lists for the content length
- **Repetitive sentence patterns** — Same sentence structure repeated (Subject-Verb-Object consistently)
- **Formulaic openings** — Starting with "The [adjective] [noun] of [topic]..."
- **Em dash overuse** — AI models (especially Claude) overuse em dashes
- **Artificial balance** — "On one hand... on the other hand..." structures

### Implementation

```typescript
// src/lib/slop/structural.ts
export function detectStructuralSlop(text: string): StructuralIssue[] {
  // Analyzes sentence patterns, formatting, and structure
}
```

## Layer 3: Voice Contrast

Compares generated text against the user's established voice profile:

- **Formality mismatch** — Generated text is too formal/casual for the profile
- **Vocabulary deviation** — Using words outside the user's typical vocabulary
- **Tone shift** — Sudden changes in emotional register
- **Length anomaly** — Sentences significantly longer/shorter than baseline

### Implementation

```typescript
// src/lib/slop/voice-contrast.ts
export function checkVoiceContrast(
  text: string,
  profile: VoiceProfile
): ContrastResult {
  // Compares text characteristics against voice profile
}
```

## Auto-Rewrite

When slop is detected, the system can attempt automatic rewrites before rejecting:

```
Detected: "Let's dive into the world of TypeScript"
Rewrite:  "TypeScript catches bugs before your users do"
```

The rewrite system:
1. Identifies the specific sloppy element
2. Preserves the core meaning
3. Applies the user's voice characteristics
4. Re-validates against all slop detectors

### Implementation

```typescript
// src/lib/slop/rewrite.ts
export function rewriteSloppy(
  text: string,
  issues: SlopIssue[],
  profile: VoiceProfile
): string {
  // Attempts to fix sloppy phrases while preserving meaning
}
```

## API Endpoint

Test slop detection via the API:

```bash
curl -X POST http://localhost:3000/api/slop/detect \
  -H "Content-Type: application/json" \
  -d '{"text": "Let'\''s dive into why this is a game-changer for developers"}'
```

Response:
```json
{
  "hasSlopIssues": true,
  "issues": [
    {
      "type": "phrase_blacklist",
      "phrase": "let's dive into",
      "position": 0,
      "severity": "high"
    },
    {
      "type": "phrase_blacklist",
      "phrase": "game-changer",
      "position": 34,
      "severity": "high"
    }
  ],
  "score": 0.85
}
```

## Configuration

### Detection Thresholds

Configured via `/api/settings/thresholds`:

| Setting | Default | Description |
|---------|---------|-------------|
| `slopScoreThreshold` | 0.3 | Max allowed slop score (0=clean, 1=all slop) |
| `autoRewriteEnabled` | true | Attempt automatic rewrite before rejecting |
| `maxRewriteAttempts` | 2 | Max rewrite attempts per detection cycle |

### Adding Custom Slop Patterns

If you notice AI patterns specific to your domain, add them:

1. **Phrases** — Add to `BANNED_PHRASES` in `src/lib/slop/phrase-blacklist.ts`
2. **Structural** — Add pattern matchers in `src/lib/slop/structural.ts`
3. **Voice-specific** — Adjust thresholds in voice profile configuration

## Why This Matters

AI content detection tools (GPTZero, etc.) work by detecting exactly these patterns. By eliminating them at generation time, ai-social-engine produces content that:

1. Sounds more natural and human
2. Matches your specific writing style
3. Avoids common AI detection triggers
4. Improves over time as new patterns are identified
