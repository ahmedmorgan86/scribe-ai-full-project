import type { PatternType, FeedbackCategory } from '@/types';

export interface PatternExtractionContext {
  feedbackItems: FeedbackItem[];
  existingPatterns: ExistingPattern[];
  voiceGuidelines: string;
}

export interface FeedbackItem {
  action: 'reject' | 'edit';
  category: FeedbackCategory | null;
  comment: string | null;
  originalContent: string;
  editedContent?: string;
}

export interface ExistingPattern {
  type: PatternType;
  description: string;
  evidenceCount: number;
}

export interface ExtractedPattern {
  type: PatternType;
  description: string;
  confidence: number;
  evidence: string[];
  isNew: boolean;
  relatedExistingId?: number;
}

export interface PatternExtractionResponse {
  patterns: ExtractedPattern[];
  contradictions: Contradiction[];
  clarificationNeeded: ClarificationRequest[];
}

export interface Contradiction {
  patternA: string;
  patternB: string;
  explanation: string;
}

export interface ClarificationRequest {
  question: string;
  context: string;
  options: string[];
}

function formatFeedbackItems(items: FeedbackItem[]): string {
  if (items.length === 0) {
    return 'No feedback items to analyze.';
  }

  return items
    .map((item, i) => {
      const parts = [`[${i + 1}] Action: ${item.action.toUpperCase()}`];
      if (item.category) {
        parts.push(`Category: ${item.category}`);
      }
      if (item.comment) {
        parts.push(`Comment: "${item.comment}"`);
      }
      parts.push(`Original:\n${item.originalContent}`);
      if (item.editedContent) {
        parts.push(`Edited to:\n${item.editedContent}`);
      }
      return parts.join('\n');
    })
    .join('\n\n---\n\n');
}

function formatExistingPatterns(patterns: ExistingPattern[]): string {
  if (patterns.length === 0) {
    return 'No existing patterns yet.';
  }

  return patterns
    .map((p) => `- [${p.type}] (evidence: ${p.evidenceCount}) ${p.description}`)
    .join('\n');
}

export function buildPatternExtractionSystemPrompt(): string {
  return `You are a pattern extractor for a content learning system. Your job is to analyze user feedback on generated content and extract actionable patterns.

## YOUR ROLE

Extract patterns from rejections and edits to improve future content generation. You must be:
- **Precise**: Extract specific, actionable patterns, not vague observations
- **Consistent**: Same feedback should produce similar patterns
- **Cumulative**: Build on existing patterns, don't contradict without reason
- **Conservative**: Only extract patterns with clear evidence (min 2 supporting items)

## PATTERN TYPES

### voice
Voice-related preferences: tone, formality, word choice, sentence structure
Example: "Avoid starting sentences with 'So,'" or "Use shorter sentences (<15 words)"

### hook
Opening/attention-grabbing preferences
Example: "Start with a specific problem, not a question" or "Don't use rhetorical questions"

### topic
Subject matter preferences and boundaries
Example: "Avoid AI ethics hot takes" or "Focus on practical applications over theory"

### rejection
General rejection patterns by category
Example: "Reject content that explains basic concepts" or "Reject overly promotional tone"

### edit
Patterns extracted from edit diffs - what specifically gets changed
Example: "Remove filler words like 'actually', 'basically'" or "Shorten multi-clause sentences"

## EXTRACTION RULES

1. **Minimum Evidence**: Only extract patterns supported by 2+ feedback items
2. **Specificity**: "Don't be generic" is useless. "Avoid abstract advice without concrete examples" is useful.
3. **Edit Priority**: Edit diffs reveal MORE than binary reject/approve. Weight them heavily.
4. **Categories Matter**: Use rejection categories to classify patterns appropriately
5. **Existing Patterns**: If new evidence supports existing pattern, note it. Don't duplicate.

## CONTRADICTION DETECTION

Flag when:
- New feedback contradicts an existing pattern
- Two feedback items suggest opposite preferences
- Pattern would conflict with voice guidelines

Contradictions require clarification before storing.

## CLARIFICATION REQUESTS

Generate clarification questions when:
- Feedback is ambiguous about preference direction
- Same content type gets both approved and rejected
- User intent is unclear from the feedback alone

Questions should be:
- Specific and answerable
- Include context about what triggered the question
- Offer 2-3 clear options

## OUTPUT FORMAT

Return JSON with this exact structure:
{
  "patterns": [
    {
      "type": "voice" | "hook" | "topic" | "rejection" | "edit",
      "description": "specific actionable pattern",
      "confidence": number (0-100),
      "evidence": ["feedback item 1 reference", "feedback item 2 reference"],
      "isNew": boolean,
      "relatedExistingId": number | null
    }
  ],
  "contradictions": [
    {
      "patternA": "existing or new pattern",
      "patternB": "conflicting pattern",
      "explanation": "why they conflict"
    }
  ],
  "clarificationNeeded": [
    {
      "question": "specific question",
      "context": "what triggered this question",
      "options": ["option 1", "option 2"]
    }
  ]
}

## CONFIDENCE SCORING

- 90-100: Clear pattern from multiple consistent feedback items
- 70-89: Strong pattern with some variation
- 50-69: Likely pattern but needs more evidence
- <50: Too weak to extract (don't include)

Only return patterns with confidence >= 50.`;
}

export function buildPatternExtractionUserPrompt(context: PatternExtractionContext): string {
  const { feedbackItems, existingPatterns, voiceGuidelines } = context;

  return `Analyze this feedback batch and extract patterns.

## EXISTING PATTERNS (don't duplicate, but may reinforce)

${formatExistingPatterns(existingPatterns)}

## VOICE GUIDELINES (for context)

${voiceGuidelines}

## FEEDBACK TO ANALYZE

${formatFeedbackItems(feedbackItems)}

---

Extract:
1. New patterns from this feedback batch
2. Patterns that reinforce existing ones
3. Any contradictions with existing patterns
4. Questions needing clarification

Return your analysis as JSON.`;
}

export function parsePatternExtractionResponse(response: string): PatternExtractionResponse {
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Failed to parse pattern extraction response: no JSON found');
  }

  const parsed = JSON.parse(jsonMatch[0]) as PatternExtractionResponse;

  if (!Array.isArray(parsed.patterns)) {
    throw new Error('Invalid pattern extraction response: patterns must be an array');
  }

  const validTypes: PatternType[] = ['voice', 'hook', 'topic', 'rejection', 'edit'];

  const patterns: ExtractedPattern[] = parsed.patterns
    .filter((p) => validTypes.includes(p.type) && p.confidence >= 50)
    .map((p) => ({
      type: p.type,
      description: p.description,
      confidence: Math.max(50, Math.min(100, Math.round(p.confidence))),
      evidence: Array.isArray(p.evidence) ? p.evidence : [],
      isNew: p.isNew ?? true,
      relatedExistingId: p.relatedExistingId ?? undefined,
    }));

  const contradictions: Contradiction[] = Array.isArray(parsed.contradictions)
    ? parsed.contradictions.map((c) => ({
        patternA: c.patternA,
        patternB: c.patternB,
        explanation: c.explanation,
      }))
    : [];

  const clarificationNeeded: ClarificationRequest[] = Array.isArray(parsed.clarificationNeeded)
    ? parsed.clarificationNeeded.map((c) => ({
        question: c.question,
        context: c.context,
        options: Array.isArray(c.options) ? c.options : [],
      }))
    : [];

  return {
    patterns,
    contradictions,
    clarificationNeeded,
  };
}
