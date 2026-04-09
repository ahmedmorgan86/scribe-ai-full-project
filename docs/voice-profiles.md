# Voice Profiles Guide

How to create and configure voice profiles for ai-social-engine.

## Overview

A voice profile defines your writing style. It tells the engine how to write content that sounds like you. The more specific your profile, the better the output.

## Quick Setup

1. Open `http://localhost:3000/config`
2. Go to the **Voice** tab
3. Paste your voice guidelines (see format below)
4. Go to the **Examples** tab
5. Add 20+ example posts that represent your voice

## Voice Guidelines Format

Voice guidelines are structured as a markdown file with specific sections:

```markdown
## Rules
Hard constraints that apply to ALL generated content.
- Never use hashtags
- Never cite Reddit or Hacker News as sources
- Threads must be 5-7 tweets maximum

## Do's
Voice characteristics to actively use.
- Start with the problem or pain point
- Use direct "you" address
- Be confident - no hedging

## Don'ts
Patterns and phrases to actively avoid.
- "Let's dive in"
- "Game-changer"
- "In this thread..."

## Examples
Gold standard posts that exemplify your voice. Add 20+ for best results.
> Your example post goes here.
> Another example post.
```

See [`VOICE_GUIDELINES_TEMPLATE.md`](../VOICE_GUIDELINES_TEMPLATE.md) for a complete template.

## Voice Characteristics

Voice characteristics are numeric sliders (0.0 - 1.0) that control generation style:

### Formality (0.0 - 1.0)

Controls the register of language used.

| Value | Example |
|-------|---------|
| 0.0 | "yo this bug drove me crazy lol" |
| 0.5 | "This bug was surprisingly tricky to debug." |
| 1.0 | "The defect presented a non-trivial debugging challenge." |

### Confidence (0.0 - 1.0)

Controls assertiveness and hedging.

| Value | Example |
|-------|---------|
| 0.0 | "Maybe this could potentially work?" |
| 0.5 | "This approach should work well for most cases." |
| 1.0 | "This is the right way to do it. Period." |

### Humor (0.0 - 1.0)

Controls wit and playfulness.

| Value | Example |
|-------|---------|
| 0.0 | "TypeScript prevents runtime errors." |
| 0.5 | "TypeScript: because future you will thank present you." |
| 1.0 | "TypeScript is just JavaScript wearing a monocle." |

### Complexity (0.0 - 1.0)

Controls technical depth.

| Value | Example |
|-------|---------|
| 0.0 | "React makes UIs easier to build." |
| 0.5 | "React's virtual DOM diffing reduces unnecessary DOM operations." |
| 1.0 | "React's reconciliation algorithm uses a heuristic O(n) approach with fiber architecture for interruptible rendering." |

### Directness (0.0 - 1.0)

Controls how quickly you get to the point.

| Value | Example |
|-------|---------|
| 0.0 | "I've been thinking about something interesting related to..." |
| 0.5 | "Here's what I learned about caching." |
| 1.0 | "Cache everything. Here's how." |

### Empathy (0.0 - 1.0)

Controls warmth and reader connection.

| Value | Example |
|-------|---------|
| 0.0 | "The data shows a 40% improvement." |
| 0.5 | "If you've struggled with this, you're not alone." |
| 1.0 | "I know that feeling when nothing works and you question everything." |

## Gold Examples

Gold examples are the most important part of your voice profile. They serve as:

1. **Training data** for the stylometry engine (statistical fingerprint)
2. **Reference posts** for embedding similarity checks
3. **Few-shot examples** in generation prompts

### How Many Examples?

| Count | Quality |
|-------|---------|
| 5-10 | Minimal — basic voice matching |
| 20-30 | Good — reliable voice consistency |
| 50+ | Excellent — nuanced style matching |

### What Makes a Good Example?

- **Authentic** — Posts you actually wrote (not edited by others)
- **Diverse** — Different topics, formats, and lengths
- **Representative** — Your typical voice, not outliers
- **Recent** — Your current style, not old posts

### Uploading Examples

Via the UI at `/config > Examples`:

```
Paste your example posts, one per line.
Each post becomes a gold example for voice matching.
```

Or via the API:

```bash
curl -X POST http://localhost:3000/api/bootstrap/gold-examples \
  -H "Content-Type: application/json" \
  -d '{"examples": ["Post 1 text", "Post 2 text", ...]}'
```

## Stylometric Baseline

After uploading 20+ gold examples, the system generates a **stylometric baseline** — a statistical fingerprint of your writing style. This includes:

- **Sentence length distribution** — mean and standard deviation
- **Punctuation patterns** — rates of periods, commas, exclamations, etc.
- **Vocabulary diversity** — type-token ratio, hapax legomena ratio
- **Function word frequencies** — usage patterns of "the", "and", "but", etc.
- **Syntactic patterns** — clause depth, subordination ratio

The baseline is stored in `data/baseline-signature.json` and used by the Stylometry Worker (Layer 4) to validate generated content.

## Drift Detection

Over time, the system monitors for **voice drift** — gradual changes in generated content that deviate from your baseline. The drift detection API at `/api/stylometric/drift` provides:

- Current drift score (0.0 = identical, 1.0 = completely different)
- Per-feature drift breakdown
- Alerts when drift exceeds configurable thresholds

## JSON Profile Format

For programmatic configuration, you can also use JSON profiles:

```json
{
  "name": "My Profile",
  "characteristics": {
    "formality": 0.3,
    "confidence": 0.8,
    "humor": 0.5,
    "complexity": 0.4,
    "directness": 0.9,
    "empathy": 0.6
  },
  "topics": ["software development", "AI/ML", "startups"],
  "rules": ["Never use hashtags"],
  "dos": ["Start with the pain point"],
  "donts": ["Let's dive in"],
  "examples": ["Example post 1", "Example post 2"]
}
```

See [`config/voice-profiles/example.json`](../config/voice-profiles/example.json) for a complete example.
