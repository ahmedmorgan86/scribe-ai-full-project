import type { PostType, Formula, Source, Pattern, Rule } from '@/types';

export interface GenerationContext {
  voiceGuidelines: string;
  formula: Formula | null;
  source: Source;
  learnedPatterns: Pattern[];
  learnedPatternsFormatted?: string;
  explicitRules?: Rule[];
  explicitRulesFormatted?: string;
  recentApprovedExamples: string[];
  postType: PostType;
}

function formatLearnedPatterns(patterns: Pattern[]): string {
  if (patterns.length === 0) {
    return 'No learned patterns yet.';
  }
  return patterns
    .map((p) => `- [${p.patternType}] ${p.description} (evidence: ${p.evidenceCount})`)
    .join('\n');
}

function formatExamples(examples: string[]): string {
  if (examples.length === 0) {
    return 'No approved examples available yet.';
  }
  return examples.map((ex, i) => `Example ${i + 1}:\n${ex}`).join('\n\n');
}

function formatFormula(formula: Formula | null): string {
  if (!formula) {
    return 'No specific formula selected. Generate content based on voice and source material.';
  }
  return `Formula: ${formula.name}\n${formula.template}`;
}

function getPostTypeInstructions(postType: PostType): string {
  switch (postType) {
    case 'thread':
      return `
OUTPUT FORMAT: Thread (5-7 tweets max)
- First tweet is the hook - must stand alone and compel reading
- Each subsequent tweet adds ONE clear point
- Final tweet provides closure or CTA
- Post all tweets together, never staggered
- Format: Return JSON array of tweet strings`;
    case 'quote':
      return `
OUTPUT FORMAT: Quote Tweet
- MUST add unique value: new information, unique angle, or audience translation
- Never just react or agree - add substance
- Reference the quoted content without restating it
- Format: Return single tweet string`;
    case 'reply':
      return `
OUTPUT FORMAT: Reply
- Add value to the conversation
- Match the tone of the original thread
- Keep it concise - replies should be punchy
- Format: Return single tweet string`;
    default:
      return `
OUTPUT FORMAT: Single Tweet
- Maximum 280 characters
- Hook in the first line
- Clear value proposition
- Format: Return single tweet string`;
  }
}

export const CONTENT_RULES = `
## ABSOLUTE RULES (violating ANY = instant rejection)

1. NEVER use hashtags - They feel spammy and dilute authenticity
2. NEVER cite Reddit, Hacker News, or similar as sources - Present discoveries as your own
3. NEVER use generic AI phrases:
   - "Let's dive in" / "Let's explore" / "Let's break this down"
   - "Here's the thing" / "Here's why"
   - "Game changer" / "Revolutionary"
   - "In this thread" / "Thread:"
   - "Hot take:" / "Unpopular opinion:"
   - "Buckle up" / "You won't believe"
   - Starting with "So," or "Look,"
   - Ending with "And that's the key" or similar wrap-ups
4. NEVER use excessive emojis (max 1-2 per post, and only if natural)
5. NEVER use listicle format with numbered items in tweets
6. NEVER be preachy or lecture the reader

## VOICE REQUIREMENTS

1. Problem-first framing - Always start with the pain point, not the solution
2. Conversational but authoritative - Talk like explaining to a smart friend
3. Specific over generic - Use concrete examples, numbers, details
4. Show don't tell - Demonstrate insight rather than claiming it
5. Earned confidence - Bold claims backed by substance
`;

export function buildGenerationSystemPrompt(context: GenerationContext): string {
  const {
    voiceGuidelines,
    formula,
    learnedPatterns,
    learnedPatternsFormatted,
    explicitRulesFormatted,
    recentApprovedExamples,
    postType,
  } = context;

  const patternsSection = learnedPatternsFormatted ?? formatLearnedPatterns(learnedPatterns);
  const rulesSection = explicitRulesFormatted ?? '';

  return `You are a content generation assistant that creates high-quality Twitter/X posts matching a specific voice and style.

${CONTENT_RULES}

## VOICE GUIDELINES FROM USER

${voiceGuidelines}
${rulesSection ? `\n${rulesSection}\n` : ''}
## LEARNED PATTERNS FROM FEEDBACK

Pay close attention to these patterns - they represent explicit user preferences learned from feedback:

${patternsSection}

## APPROVED EXAMPLES

These posts were approved. Match their style, tone, and approach:

${formatExamples(recentApprovedExamples)}

## CONTENT FORMULA

${formatFormula(formula)}

${getPostTypeInstructions(postType)}

## QUALITY CHECKLIST (verify before output)

- [ ] Does it start with a compelling hook?
- [ ] Is the pain point clear and relatable?
- [ ] Does it provide genuine value or insight?
- [ ] Is it free of all banned phrases and patterns?
- [ ] Does it match the voice guidelines?
- [ ] Does it follow the explicit rules above?
- [ ] Would YOU want to read this?

Generate content that feels human, valuable, and authentic.`;
}

export function buildGenerationUserPrompt(context: GenerationContext): string {
  const { source, postType } = context;

  const sourceInfo = `
Source Type: ${source.sourceType}
Source Content:
${source.content}

${source.metadata.authorHandle ? `Author: @${source.metadata.authorHandle}` : ''}
${source.metadata.url ? `URL: ${source.metadata.url}` : ''}
`.trim();

  return `Create a ${postType} post based on this source material:

${sourceInfo}

Transform this into original content that:
1. Extracts the key insight or value
2. Reframes it through the voice guidelines
3. Adds unique perspective or context
4. Never directly copies or closely paraphrases

Return ONLY the generated content, no explanations or meta-commentary.`;
}
