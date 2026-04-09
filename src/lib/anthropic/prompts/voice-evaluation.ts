import type { VoiceScore } from '@/types';

export interface VoiceEvaluationContext {
  voiceGuidelines: string;
  draftContent: string;
  recentApprovedExamples: string[];
  learnedVoicePatterns: string[];
}

export interface VoiceEvaluationResponse {
  passed: boolean;
  score: VoiceScore;
  failureReasons: string[];
  strengths: string[];
  suggestions: string[];
}

function formatApprovedExamples(examples: string[]): string {
  if (examples.length === 0) {
    return 'No approved examples available yet. Evaluate based on voice guidelines only.';
  }
  return examples.map((ex, i) => `[${i + 1}] ${ex}`).join('\n\n');
}

function formatLearnedPatterns(patterns: string[]): string {
  if (patterns.length === 0) {
    return 'No learned patterns yet.';
  }
  return patterns.map((p) => `- ${p}`).join('\n');
}

export function buildVoiceEvaluationSystemPrompt(): string {
  return `You are a voice consistency evaluator for Twitter/X content. Your job is to assess whether draft content matches a specific voice profile.

## YOUR ROLE

You evaluate content against voice guidelines and approved examples. You must be:
- **Precise**: Score each dimension accurately based on evidence
- **Consistent**: Same content should always receive similar scores
- **Constructive**: Provide actionable feedback, not vague criticism
- **Calibrated**: 70+ means "good enough to post", 90+ means "exceptional"

## SCORING DIMENSIONS (0-100 each)

### Voice (weight: 35%)
Does the content sound like it was written by this specific person?
- Matches sentence structure and rhythm
- Uses appropriate vocabulary level
- Maintains consistent persona
- Has the right level of formality/casualness

### Hook (weight: 25%)
How effective is the opening?
- Immediately grabs attention
- Creates curiosity or tension
- Problem-first framing (starts with pain, not solution)
- Would stop someone scrolling

### Topic (weight: 20%)
Is this content on-brand and relevant?
- Falls within the author's typical subject matter
- Audience would expect this content
- Not random or off-topic for the persona

### Originality (weight: 20%)
Does this add unique value?
- Fresh perspective, not rehashed takes
- Specific insights, not generic advice
- Adds to the conversation, doesn't just participate

## OVERALL SCORE CALCULATION

Overall = (Voice × 0.35) + (Hook × 0.25) + (Topic × 0.20) + (Originality × 0.20)

## PASSING THRESHOLD

Content passes evaluation if:
1. Overall score >= 70
2. No individual dimension < 50
3. No critical voice violations

## CRITICAL VOICE VIOLATIONS (automatic fail regardless of score)

- Uses banned AI phrases ("Let's dive in", "Here's the thing", etc.)
- Uses hashtags
- Cites Reddit/HN as sources
- Excessive emoji usage (>2)
- Listicle format in tweets
- Preachy or lecturing tone

## OUTPUT FORMAT

Return JSON with this exact structure:
{
  "passed": boolean,
  "score": {
    "voice": number,
    "hook": number,
    "topic": number,
    "originality": number,
    "overall": number
  },
  "failureReasons": string[],
  "strengths": string[],
  "suggestions": string[]
}

Be specific in feedback. Instead of "hook is weak", say "opening doesn't establish a clear problem or tension".`;
}

export function buildVoiceEvaluationUserPrompt(context: VoiceEvaluationContext): string {
  const { voiceGuidelines, draftContent, recentApprovedExamples, learnedVoicePatterns } = context;

  return `Evaluate this draft content against the voice profile.

## VOICE GUIDELINES

${voiceGuidelines}

## LEARNED VOICE PATTERNS

${formatLearnedPatterns(learnedVoicePatterns)}

## APPROVED EXAMPLES (reference for voice matching)

${formatApprovedExamples(recentApprovedExamples)}

## DRAFT CONTENT TO EVALUATE

${draftContent}

---

Evaluate the draft against the voice guidelines and examples. Return your assessment as JSON.

Focus on:
1. Does it SOUND like the examples?
2. Would the target audience recognize this as authentic?
3. Are there any critical violations?
4. What specific improvements would help?`;
}

export function parseVoiceEvaluationResponse(response: string): VoiceEvaluationResponse {
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Failed to parse voice evaluation response: no JSON found');
  }

  const parsed = JSON.parse(jsonMatch[0]) as VoiceEvaluationResponse;

  if (
    typeof parsed.passed !== 'boolean' ||
    typeof parsed.score?.voice !== 'number' ||
    typeof parsed.score?.hook !== 'number' ||
    typeof parsed.score?.topic !== 'number' ||
    typeof parsed.score?.originality !== 'number' ||
    typeof parsed.score?.overall !== 'number'
  ) {
    throw new Error('Invalid voice evaluation response structure');
  }

  return {
    passed: parsed.passed,
    score: {
      voice: Math.round(parsed.score.voice),
      hook: Math.round(parsed.score.hook),
      topic: Math.round(parsed.score.topic),
      originality: Math.round(parsed.score.originality),
      overall: Math.round(parsed.score.overall),
    },
    failureReasons: parsed.failureReasons ?? [],
    strengths: parsed.strengths ?? [],
    suggestions: parsed.suggestions ?? [],
  };
}
