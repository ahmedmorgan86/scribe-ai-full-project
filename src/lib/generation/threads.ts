import type { Source, PostReasoning, Formula, StoredVoiceEvaluation } from '@/types';
import { trackedCompletion } from '@/lib/anthropic/cost-tracking';
import { CONTENT_RULES } from '@/lib/anthropic/prompts/generation';
import {
  formatGuidelinesForPrompt,
  getVoiceGuidelinesFromQdrant,
  hasVoiceGuidelines,
} from '@/lib/voice/guidelines';
import { validateVoice, toStoredVoiceEvaluation } from '@/lib/voice/validation-pipeline';
import {
  detectSlop,
  shouldTriggerRewrite,
  toSlopResult,
  needsHumanReview,
} from '@/lib/slop/detector';
import { rewriteSloppyContent, RewriteContext } from '@/lib/slop/rewrite';
import { selectFormulaForContent } from '@/lib/formulas/loader';
import { listPatterns } from '@/db/models/patterns';
import { getSimilarApprovedPosts } from '@/lib/voice/embeddings';
import type { SlopResult } from '@/types';

export const MIN_THREAD_TWEETS = 2;
export const MAX_THREAD_TWEETS = 7;
export const TWEET_MAX_LENGTH = 280;

export interface ThreadTweet {
  position: number;
  content: string;
  role: 'hook' | 'body' | 'conclusion';
}

export interface ThreadGenerationOptions {
  minTweets?: number;
  maxTweets?: number;
  maxRewriteAttempts?: number;
  skipVoiceValidation?: boolean;
  skipSlopDetection?: boolean;
  forceFormula?: string;
}

export interface ThreadOutput {
  tweets: ThreadTweet[];
  reasoning: PostReasoning;
  voiceEvaluation: StoredVoiceEvaluation | null;
  slopResult: SlopResult;
  formula: Formula | null;
  totalCostUsd: number;
  rewriteCount: number;
  flagForHumanReview: boolean;
  success: boolean;
  failureReason: string | null;
}

interface RawThreadResponse {
  tweets: string[];
  reasoning: {
    keyInsight: string;
    whyItWorks: string;
    timing: string;
    concerns: string[];
  };
}

function buildThreadSystemPrompt(
  voiceGuidelines: string,
  learnedPatterns: string,
  approvedExamples: string[],
  formula: Formula | null
): string {
  const formulaText = formula
    ? `## CONTENT FORMULA\n\nFormula: ${formula.name}\n${formula.template}`
    : 'No specific formula. Generate thread based on voice and source.';

  const examplesText =
    approvedExamples.length > 0
      ? approvedExamples.map((ex, i) => `Example ${i + 1}:\n${ex}`).join('\n\n')
      : 'No approved examples yet.';

  return `You are a thread generation assistant creating high-quality Twitter/X threads.

${CONTENT_RULES}

## VOICE GUIDELINES

${voiceGuidelines}

## LEARNED PATTERNS

${learnedPatterns}

## APPROVED EXAMPLES (match this style)

${examplesText}

${formulaText}

## THREAD STRUCTURE REQUIREMENTS

1. **Hook Tweet (Tweet 1)**: The most important tweet
   - Must stand completely alone as a compelling statement
   - Creates curiosity or states a bold claim
   - Makes readers WANT to read more
   - No "Thread:" or "1/" prefix

2. **Body Tweets (Tweets 2-N-1)**: Each adds ONE clear point
   - One idea per tweet
   - Build logically on the previous tweet
   - Each could almost stand alone
   - Use concrete examples, not abstractions

3. **Conclusion Tweet (Final)**: Provides closure
   - Summarizes the key takeaway OR
   - Calls to action (follow, share, try it) OR
   - Leaves with a memorable thought
   - Occasional "Follow for more X" is OK (not every thread)

## CONSTRAINTS

- Minimum ${MIN_THREAD_TWEETS} tweets, maximum ${MAX_THREAD_TWEETS} tweets
- Each tweet max ${TWEET_MAX_LENGTH} characters
- Post all at once (structure assumes simultaneous posting)
- NO numbering (1/, 2/) - tweets are posted together
- NO "Thread:" announcements`;
}

function buildThreadUserPrompt(source: Source, targetTweetCount: number): string {
  const sourceInfo = `
Source Type: ${source.sourceType}
Content:
${source.content}

${source.metadata.authorHandle ? `Author: @${source.metadata.authorHandle}` : ''}
${source.metadata.url ? `URL: ${source.metadata.url}` : ''}
`.trim();

  return `Create a ${targetTweetCount}-tweet thread based on this source material:

${sourceInfo}

Transform this into an original thread that:
1. Opens with a hook that makes people stop scrolling
2. Develops the insight across ${targetTweetCount} connected tweets
3. Each tweet adds value (no filler)
4. Closes with impact

Return JSON:
{
  "tweets": ["tweet1 content", "tweet2 content", ...],
  "reasoning": {
    "keyInsight": "the core insight being shared",
    "whyItWorks": "why this thread will resonate",
    "timing": "any timing considerations",
    "concerns": ["any concerns"]
  }
}`;
}

function parseThreadResponse(response: string): RawThreadResponse {
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as RawThreadResponse;
      if (Array.isArray(parsed.tweets) && parsed.tweets.length >= MIN_THREAD_TWEETS) {
        return {
          tweets: parsed.tweets
            .slice(0, MAX_THREAD_TWEETS)
            .map((t) => (typeof t === 'string' ? t.trim() : String(t))),
          reasoning: {
            keyInsight: parsed.reasoning?.keyInsight ?? '',
            whyItWorks: parsed.reasoning?.whyItWorks ?? '',
            timing: parsed.reasoning?.timing ?? 'No specific timing',
            concerns: parsed.reasoning?.concerns ?? [],
          },
        };
      }
    }
  } catch {
    // Fall through to extraction
  }

  const lines = response.split('\n').filter((line) => line.trim().length > 0);
  const tweets: string[] = [];
  for (const line of lines) {
    const cleaned = line.replace(/^\d+[./)]\s*/, '').trim();
    if (cleaned.length > 0 && cleaned.length <= TWEET_MAX_LENGTH) {
      tweets.push(cleaned);
      if (tweets.length >= MAX_THREAD_TWEETS) break;
    }
  }

  if (tweets.length < MIN_THREAD_TWEETS) {
    tweets.push(response.slice(0, TWEET_MAX_LENGTH).trim());
  }

  return {
    tweets: tweets.slice(0, MAX_THREAD_TWEETS),
    reasoning: {
      keyInsight: 'Generated from source material',
      whyItWorks: 'Thread format for complex topic',
      timing: 'No specific timing',
      concerns: [],
    },
  };
}

function toThreadTweets(tweets: string[]): ThreadTweet[] {
  return tweets.map((content, index) => ({
    position: index + 1,
    content,
    role: index === 0 ? 'hook' : index === tweets.length - 1 ? 'conclusion' : 'body',
  }));
}

function determineTargetTweetCount(
  sourceContent: string,
  options: ThreadGenerationOptions
): number {
  const minTweets = options.minTweets ?? MIN_THREAD_TWEETS;
  const maxTweets = options.maxTweets ?? MAX_THREAD_TWEETS;

  const contentLength = sourceContent.length;
  const paragraphMatches = sourceContent.match(/\n\n/g);
  const hasMultipleParagraphs = (paragraphMatches?.length ?? 0) >= 2;
  const hasSteps =
    /step|first|then|next|finally|how to|guide/i.test(sourceContent) ??
    /\d+\.\s/.test(sourceContent);
  const pointMatches = sourceContent.match(/[-•]\s/g);
  const hasMultiplePoints = (pointMatches?.length ?? 0) >= 3;

  let targetCount = minTweets;

  if (contentLength > 1000 || hasMultipleParagraphs) {
    targetCount = Math.max(targetCount, 4);
  }
  if (hasSteps || hasMultiplePoints) {
    targetCount = Math.max(targetCount, 5);
  }
  if (contentLength > 2000) {
    targetCount = Math.max(targetCount, 6);
  }

  return Math.min(Math.max(targetCount, minTweets), maxTweets);
}

export function validateThread(tweets: ThreadTweet[]): {
  valid: boolean;
  issues: string[];
} {
  const issues: string[] = [];

  if (tweets.length < MIN_THREAD_TWEETS) {
    issues.push(`Thread too short: ${tweets.length} tweets (minimum ${MIN_THREAD_TWEETS})`);
  }
  if (tweets.length > MAX_THREAD_TWEETS) {
    issues.push(`Thread too long: ${tweets.length} tweets (maximum ${MAX_THREAD_TWEETS})`);
  }

  for (const tweet of tweets) {
    if (tweet.content.length > TWEET_MAX_LENGTH) {
      issues.push(
        `Tweet ${tweet.position} exceeds ${TWEET_MAX_LENGTH} chars (${tweet.content.length})`
      );
    }
    if (tweet.content.length < 10) {
      issues.push(`Tweet ${tweet.position} too short (${tweet.content.length} chars)`);
    }
  }

  const hookTweet = tweets[0];
  if (hookTweet !== undefined && /^(thread|1\/|here's)/i.test(hookTweet.content)) {
    issues.push('Hook tweet starts with banned pattern (Thread:, 1/, etc.)');
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

export function threadToContent(tweets: ThreadTweet[]): string {
  return tweets.map((t) => t.content).join('\n\n---\n\n');
}

export function contentToThread(content: string): ThreadTweet[] {
  const tweets = content.split(/\n\n---\n\n/).filter((t) => t.trim().length > 0);
  return toThreadTweets(tweets);
}

async function runThreadSlopDetection(
  tweets: ThreadTweet[],
  guidelines: string,
  maxRewriteAttempts: number
): Promise<{
  tweets: ThreadTweet[];
  slopResult: SlopResult;
  rewriteCount: number;
  costUsd: number;
}> {
  let rewriteCount = 0;
  let totalCostUsd = 0;
  let currentTweets = [...tweets];

  const combinedContent = threadToContent(currentTweets);
  let slopResult = await detectSlop(combinedContent);

  while (
    slopResult.isSlop &&
    shouldTriggerRewrite(slopResult) &&
    rewriteCount < maxRewriteAttempts
  ) {
    const similarPosts = await getSimilarApprovedPosts(combinedContent, {
      nResults: 3,
      threshold: 0.5,
    });

    const rewriteContext: RewriteContext = {
      voiceGuidelines: guidelines,
      approvedExamples: similarPosts.map((p) => p.content),
    };

    const rewriteResult = await rewriteSloppyContent(combinedContent, slopResult, rewriteContext);
    totalCostUsd += rewriteResult.costUsd;

    if (rewriteResult.success) {
      currentTweets = contentToThread(rewriteResult.rewrittenContent);
      rewriteCount++;
      const newCombined = threadToContent(currentTweets);
      slopResult = await detectSlop(newCombined);
    } else {
      break;
    }
  }

  return {
    tweets: currentTweets,
    slopResult: toSlopResult(slopResult),
    rewriteCount,
    costUsd: totalCostUsd,
  };
}

export async function generateThread(
  source: Source,
  options: ThreadGenerationOptions = {}
): Promise<ThreadOutput> {
  const {
    maxRewriteAttempts = 2,
    skipVoiceValidation = false,
    skipSlopDetection = false,
  } = options;

  let totalCostUsd = 0;

  const hasGuidelines = await hasVoiceGuidelines();
  const guidelines = hasGuidelines
    ? await getVoiceGuidelinesFromQdrant()
    : { dos: [], donts: [], examples: [], rules: [], raw: '' };
  const voiceGuidelinesText = formatGuidelinesForPrompt(guidelines);

  const learnedPatterns = listPatterns({
    orderBy: 'evidence_count',
    orderDir: 'desc',
    limit: 20,
  });
  const learnedPatternsText =
    learnedPatterns.length > 0
      ? learnedPatterns.map((p) => `- [${p.patternType}] ${p.description}`).join('\n')
      : 'No learned patterns yet.';

  const similarPosts = await getSimilarApprovedPosts(source.content, {
    nResults: 5,
    threshold: 0.5,
  });
  const approvedExamples = similarPosts.map((p) => p.content);

  let formula: Formula | null = null;
  if (options.forceFormula) {
    const matches = selectFormulaForContent(source.content, 'thread');
    formula = matches.find((m) => m.formula.name === options.forceFormula)?.formula ?? null;
  } else {
    const matches = selectFormulaForContent(source.content, 'thread');
    formula = matches[0]?.formula ?? null;
  }

  const targetTweetCount = determineTargetTweetCount(source.content, options);
  const systemPrompt = buildThreadSystemPrompt(
    voiceGuidelinesText,
    learnedPatternsText,
    approvedExamples,
    formula
  );
  const userPrompt = buildThreadUserPrompt(source, targetTweetCount);

  const result = await trackedCompletion(userPrompt, {
    model: 'opus',
    systemPrompt,
    maxTokens: 4096,
    temperature: 0.7,
  });
  totalCostUsd += result.costUsd;

  const parsed = parseThreadResponse(result.content);
  let tweets = toThreadTweets(parsed.tweets);

  const validation = validateThread(tweets);
  if (!validation.valid) {
    return {
      tweets,
      reasoning: {
        source: source.sourceId,
        whyItWorks: parsed.reasoning.whyItWorks,
        voiceMatch: 0,
        timing: parsed.reasoning.timing,
        concerns: [...validation.issues, ...parsed.reasoning.concerns],
      },
      voiceEvaluation: null,
      slopResult: { isSlop: false, detectedBy: [], flagForReview: false },
      formula,
      totalCostUsd,
      rewriteCount: 0,
      flagForHumanReview: true,
      success: false,
      failureReason: `Thread validation failed: ${validation.issues.join(', ')}`,
    };
  }

  let slopResult: SlopResult = { isSlop: false, detectedBy: [], flagForReview: false };
  let rewriteCount = 0;

  if (!skipSlopDetection) {
    const slopAndRewrite = await runThreadSlopDetection(
      tweets,
      voiceGuidelinesText,
      maxRewriteAttempts
    );
    tweets = slopAndRewrite.tweets;
    slopResult = slopAndRewrite.slopResult;
    rewriteCount = slopAndRewrite.rewriteCount;
    totalCostUsd += slopAndRewrite.costUsd;
  }

  let voiceEvaluation: StoredVoiceEvaluation | null = null;
  if (!skipVoiceValidation) {
    const combinedContent = threadToContent(tweets);
    const validationResult = await validateVoice(combinedContent);
    voiceEvaluation = toStoredVoiceEvaluation(validationResult);
    totalCostUsd += validationResult.costUsd;
  }

  const flagForHumanReview = needsHumanReview({
    ...slopResult,
    issues: [],
    suggestions: [],
  });
  const success = !slopResult.isSlop && (voiceEvaluation?.passed ?? true);

  const reasoning: PostReasoning = {
    source: source.sourceId,
    whyItWorks: parsed.reasoning.whyItWorks ?? 'Thread format for complex topic',
    voiceMatch: voiceEvaluation?.score?.overall ?? 0,
    timing: parsed.reasoning.timing ?? 'Evergreen content',
    concerns: [...parsed.reasoning.concerns, ...(voiceEvaluation?.failureReasons ?? [])],
  };

  const failureReason = success
    ? null
    : slopResult.isSlop
      ? 'Thread flagged as slop'
      : 'Voice validation failed';

  return {
    tweets,
    reasoning,
    voiceEvaluation,
    slopResult,
    formula,
    totalCostUsd,
    rewriteCount,
    flagForHumanReview,
    success,
    failureReason,
  };
}

export function formatThreadOutput(output: ThreadOutput): string {
  const lines: string[] = [];

  lines.push(`=== THREAD GENERATION ${output.success ? 'SUCCESS' : 'INCOMPLETE'} ===`);
  lines.push('');
  lines.push(`Tweet Count: ${output.tweets.length}`);
  lines.push(`Formula: ${output.formula?.name ?? 'None'}`);
  lines.push(`Rewrite Count: ${output.rewriteCount}`);
  lines.push(`Total Cost: $${output.totalCostUsd.toFixed(4)}`);
  lines.push('');

  lines.push('--- THREAD CONTENT ---');
  for (const tweet of output.tweets) {
    lines.push(`[${tweet.position}/${output.tweets.length}] (${tweet.role})`);
    lines.push(tweet.content);
    lines.push(`(${tweet.content.length} chars)`);
    lines.push('');
  }

  lines.push('--- REASONING ---');
  lines.push(`Source: ${output.reasoning.source}`);
  lines.push(`Why It Works: ${output.reasoning.whyItWorks}`);
  lines.push(`Voice Match: ${output.reasoning.voiceMatch}%`);
  lines.push(`Timing: ${output.reasoning.timing}`);
  if (output.reasoning.concerns.length > 0) {
    lines.push('Concerns:');
    for (const concern of output.reasoning.concerns) {
      lines.push(`  - ${concern}`);
    }
  }
  lines.push('');

  if (output.voiceEvaluation) {
    lines.push('--- VOICE EVALUATION ---');
    lines.push(`Passed: ${output.voiceEvaluation.passed}`);
    lines.push(`Overall Score: ${output.voiceEvaluation.score.overall}`);
    lines.push('');
  }

  lines.push('--- SLOP DETECTION ---');
  lines.push(`Is Slop: ${output.slopResult.isSlop}`);
  lines.push(`Detected By: ${output.slopResult.detectedBy.join(', ') || 'None'}`);
  lines.push(`Flag for Review: ${output.flagForHumanReview}`);

  if (output.failureReason) {
    lines.push('');
    lines.push(`*** FAILURE: ${output.failureReason} ***`);
  }

  return lines.join('\n');
}
