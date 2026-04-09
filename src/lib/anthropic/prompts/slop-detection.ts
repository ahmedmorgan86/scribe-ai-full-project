import type { SlopResult, SlopDetector } from '@/types';

export interface SlopDetectionContext {
  draftContent: string;
  voiceGuidelines: string;
  approvedExamples: string[];
  knownSlopPhrases: string[];
}

export interface SlopDetectionResponse {
  isSlop: boolean;
  detectedBy: SlopDetector[];
  flagForReview: boolean;
  confidence: number;
  issues: SlopIssue[];
  suggestions: string[];
}

export interface SlopIssue {
  detector: SlopDetector;
  description: string;
  severity: 'low' | 'medium' | 'high';
  location?: string;
}

export const BANNED_PHRASES = [
  "let's dive in",
  "let's explore",
  "let's break this down",
  "let's unpack",
  "here's the thing",
  "here's why",
  "here's what",
  'game changer',
  'game-changer',
  'revolutionary',
  'in this thread',
  'thread:',
  'a thread',
  'hot take:',
  'unpopular opinion:',
  'buckle up',
  "you won't believe",
  'mind-blowing',
  'mind blowing',
  "and that's the key",
  "that's the secret",
  'the truth is',
  'the reality is',
  'pro tip:',
  'life hack',
  'secret sauce',
  'unlock',
  'unleash',
  'leverage',
  'optimize',
  'synergy',
  'paradigm shift',
  'deep dive',
  'at the end of the day',
  'it goes without saying',
  'needless to say',
  'to be honest',
  'honestly speaking',
  "i'll be honest",
  'not gonna lie',
  'real talk',
  "here's a secret",
  'little known fact',
  "most people don't know",
  'what nobody tells you',
  'the hidden truth',
];

export const STRUCTURAL_PATTERNS = {
  excessiveEmoji: new RegExp('[\\u{1F300}-\\u{1F9FF}]', 'gu'),
  listicleFormat: /^[1-9][0-9]?[.)]\s/m,
  hashtag: /#[a-zA-Z0-9_]+/g,
  allCapsWords: /\b[A-Z]{4,}\b/g,
  excessivePunctuation: /[!?]{3,}/g,
  clickbaitOpening: /^(So,|Look,|Okay so|Here's the deal)/i,
};

function formatApprovedExamples(examples: string[]): string {
  if (examples.length === 0) {
    return 'No approved examples available.';
  }
  return examples.map((ex, i) => `[${i + 1}] ${ex}`).join('\n\n');
}

function formatKnownPhrases(phrases: string[]): string {
  return phrases.map((p) => `- "${p}"`).join('\n');
}

export function buildSlopDetectionSystemPrompt(): string {
  return `You are a slop detector for Twitter/X content. Your job is to identify AI-generated patterns, generic content, and inauthenticity.

## YOUR ROLE

Detect content that feels artificial, generic, or misaligned with human voice patterns. Be:
- **Vigilant**: Catch subtle AI patterns humans miss
- **Calibrated**: Not everything unusual is slop - distinguish style from artificiality
- **Specific**: Identify exact issues, not vague concerns
- **Actionable**: Flag only fixable problems

## DETECTION DIMENSIONS

### 1. Phrase Detection (detector: "phrase")
Look for:
- Banned AI-typical phrases (provided in context)
- Overused buzzwords and corporate speak
- Filler phrases that add no value
- Phrases that scream "written by AI"

Severity: HIGH - these are instant tells

### 2. Structural Detection (detector: "structural")
Look for:
- Listicle format (numbered lists in tweet content)
- Excessive emoji usage (>2 emojis)
- Hashtags (never acceptable)
- ALL CAPS abuse
- Excessive punctuation (!!!, ???)
- Formulaic openings/closings
- Perfect parallel structure (too polished)

Severity: MEDIUM to HIGH depending on pattern

### 3. Semantic Detection (detector: "semantic")
Look for:
- Generic advice that could apply to anything
- Vague claims without specifics
- Repetitive sentence structures
- Content that says nothing new
- Platitudes disguised as insights
- Over-explanation of obvious points

Severity: MEDIUM - often salvageable with edits

### 4. Voice Contrast Detection (detector: "voice-contrast")
Compare against voice guidelines and approved examples:
- Tone mismatch (too formal, too casual, too preachy)
- Vocabulary outside typical range
- Sentence rhythm that doesn't match
- Persona inconsistency
- Missing characteristic quirks

Severity: LOW to HIGH depending on deviation

## DECISION THRESHOLDS

**isSlop = true** if:
- ANY phrase detector hit (banned phrases)
- Structural issues with HIGH severity
- Multiple semantic issues
- Severe voice contrast

**flagForReview = true** if:
- isSlop is true
- Borderline cases (could go either way)
- Voice contrast issues need human judgment
- Content has potential but needs editing

## CONFIDENCE SCORING

- 90-100: Definitely slop, clear issues
- 70-89: Likely slop, some issues
- 50-69: Borderline, needs review
- 30-49: Probably fine, minor concerns
- 0-29: Clean, no issues detected

## OUTPUT FORMAT

Return JSON with this exact structure:
{
  "isSlop": boolean,
  "detectedBy": ["phrase" | "structural" | "semantic" | "voice-contrast"],
  "flagForReview": boolean,
  "confidence": number,
  "issues": [
    {
      "detector": "phrase" | "structural" | "semantic" | "voice-contrast",
      "description": "specific issue found",
      "severity": "low" | "medium" | "high",
      "location": "optional: quote of problematic text"
    }
  ],
  "suggestions": ["specific actionable improvement"]
}

Be ruthless but fair. Authentic human content sometimes looks unusual - don't flag creativity as slop.`;
}

export function buildSlopDetectionUserPrompt(context: SlopDetectionContext): string {
  const { draftContent, voiceGuidelines, approvedExamples, knownSlopPhrases } = context;

  return `Analyze this content for slop patterns.

## BANNED PHRASES (instant fail if found)

${formatKnownPhrases(knownSlopPhrases)}

## VOICE GUIDELINES (for voice-contrast detection)

${voiceGuidelines}

## APPROVED EXAMPLES (reference for authentic voice)

${formatApprovedExamples(approvedExamples)}

## CONTENT TO ANALYZE

${draftContent}

---

Scan for:
1. Any banned phrases or close variants
2. Structural patterns (emoji, hashtags, listicles, formatting)
3. Generic/semantic issues (vague, platitudes, over-explained)
4. Voice contrast with guidelines and examples

Return your analysis as JSON.`;
}

export function parseSlopDetectionResponse(response: string): SlopDetectionResponse {
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Failed to parse slop detection response: no JSON found');
  }

  const parsed = JSON.parse(jsonMatch[0]) as SlopDetectionResponse;

  if (
    typeof parsed.isSlop !== 'boolean' ||
    !Array.isArray(parsed.detectedBy) ||
    typeof parsed.flagForReview !== 'boolean' ||
    typeof parsed.confidence !== 'number' ||
    !Array.isArray(parsed.issues)
  ) {
    throw new Error('Invalid slop detection response structure');
  }

  const validDetectors: SlopDetector[] = ['phrase', 'structural', 'semantic', 'voice-contrast'];
  const filteredDetectors = parsed.detectedBy.filter((d): d is SlopDetector =>
    validDetectors.includes(d)
  );

  return {
    isSlop: parsed.isSlop,
    detectedBy: filteredDetectors,
    flagForReview: parsed.flagForReview,
    confidence: Math.max(0, Math.min(100, Math.round(parsed.confidence))),
    issues: parsed.issues.map((issue) => ({
      detector: issue.detector,
      description: issue.description,
      severity: issue.severity,
      location: issue.location,
    })),
    suggestions: parsed.suggestions ?? [],
  };
}

export function toSlopResult(response: SlopDetectionResponse): SlopResult {
  return {
    isSlop: response.isSlop,
    detectedBy: response.detectedBy,
    flagForReview: response.flagForReview,
  };
}
