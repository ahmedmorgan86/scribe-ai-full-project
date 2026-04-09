import { trackedCompletion, TrackedCompletionResult } from '@/lib/anthropic/cost-tracking';
import { CONTENT_RULES } from '@/lib/anthropic/prompts/generation';
import { DetailedSlopResult, SlopIssue } from './detector';

export interface RewriteContext {
  voiceGuidelines: string;
  approvedExamples: string[];
}

export interface RewriteResult {
  rewrittenContent: string;
  changesDescription: string;
  costUsd: number;
  costEntryId: number;
  success: boolean;
}

export interface RewriteOptions {
  maxAttempts?: number;
}

function formatSlopIssues(issues: SlopIssue[]): string {
  if (issues.length === 0) {
    return 'No specific issues provided.';
  }

  return issues
    .map((issue) => {
      const severity = issue.severity.toUpperCase();
      return `- [${severity}] ${issue.description}`;
    })
    .join('\n');
}

function formatApprovedExamples(examples: string[]): string {
  if (examples.length === 0) {
    return 'No approved examples available.';
  }
  return examples.map((ex, i) => `[${i + 1}] ${ex}`).join('\n\n');
}

function buildRewriteSystemPrompt(context: RewriteContext): string {
  const { voiceGuidelines, approvedExamples } = context;

  return `You are a content rewriter that fixes AI-generated patterns and slop issues while preserving the core message and matching voice guidelines.

${CONTENT_RULES}

## VOICE GUIDELINES

${voiceGuidelines}

## APPROVED EXAMPLES (match this style)

${formatApprovedExamples(approvedExamples)}

## REWRITING RULES

1. **Fix the identified issues** - Address each slop issue specifically
2. **Preserve the core insight** - Keep the main point intact
3. **Match the voice** - Sound like the approved examples
4. **Be concise** - Twitter has character limits
5. **No new slop** - Don't introduce new AI patterns while fixing old ones

## OUTPUT FORMAT

Return JSON with exactly this structure:
{
  "rewrittenContent": "the improved content",
  "changesDescription": "brief explanation of changes made"
}`;
}

function buildRewriteUserPrompt(originalContent: string, slopResult: DetailedSlopResult): string {
  return `Rewrite this content to fix the detected slop issues.

## ORIGINAL CONTENT

${originalContent}

## DETECTED ISSUES TO FIX

${formatSlopIssues(slopResult.issues)}

## SUGGESTIONS FROM DETECTION

${slopResult.suggestions.length > 0 ? slopResult.suggestions.map((s) => `- ${s}`).join('\n') : 'No specific suggestions.'}

---

Rewrite the content to:
1. Remove/replace banned phrases
2. Fix structural issues (emoji, hashtags, listicle format)
3. Make it sound more human and authentic
4. Preserve the core message and insight

Return your rewrite as JSON.`;
}

interface RewriteResponse {
  rewrittenContent: string;
  changesDescription: string;
}

function parseRewriteResponse(response: string): RewriteResponse {
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Failed to parse rewrite response: no JSON found');
  }

  const parsed = JSON.parse(jsonMatch[0]) as RewriteResponse;

  if (
    typeof parsed.rewrittenContent !== 'string' ||
    typeof parsed.changesDescription !== 'string'
  ) {
    throw new Error('Invalid rewrite response structure');
  }

  return {
    rewrittenContent: parsed.rewrittenContent.trim(),
    changesDescription: parsed.changesDescription,
  };
}

export async function rewriteSloppyContent(
  originalContent: string,
  slopResult: DetailedSlopResult,
  context: RewriteContext
): Promise<RewriteResult> {
  const systemPrompt = buildRewriteSystemPrompt(context);
  const userPrompt = buildRewriteUserPrompt(originalContent, slopResult);

  let result: TrackedCompletionResult;
  try {
    result = await trackedCompletion(userPrompt, {
      model: 'sonnet',
      systemPrompt,
      maxTokens: 1024,
      temperature: 0.5,
    });
  } catch (error) {
    return {
      rewrittenContent: originalContent,
      changesDescription: `Rewrite failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      costUsd: 0,
      costEntryId: -1,
      success: false,
    };
  }

  try {
    const parsed = parseRewriteResponse(result.content);
    return {
      rewrittenContent: parsed.rewrittenContent,
      changesDescription: parsed.changesDescription,
      costUsd: result.costUsd,
      costEntryId: result.costEntryId,
      success: true,
    };
  } catch (parseError) {
    return {
      rewrittenContent: originalContent,
      changesDescription: `Failed to parse rewrite response: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`,
      costUsd: result.costUsd,
      costEntryId: result.costEntryId,
      success: false,
    };
  }
}

export async function attemptRewriteWithRetry(
  originalContent: string,
  slopResult: DetailedSlopResult,
  context: RewriteContext,
  options: RewriteOptions = {}
): Promise<RewriteResult> {
  const { maxAttempts = 2 } = options;

  let lastResult: RewriteResult | null = null;
  let totalCost = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await rewriteSloppyContent(
      lastResult?.rewrittenContent ?? originalContent,
      slopResult,
      context
    );

    totalCost += result.costUsd;

    if (result.success) {
      return {
        ...result,
        costUsd: totalCost,
        changesDescription:
          attempt > 1
            ? `${result.changesDescription} (after ${attempt} attempt(s))`
            : result.changesDescription,
      };
    }

    lastResult = result;
  }

  return {
    rewrittenContent: originalContent,
    changesDescription: `Rewrite failed after ${maxAttempts} attempt(s)`,
    costUsd: totalCost,
    costEntryId: lastResult?.costEntryId ?? -1,
    success: false,
  };
}

export function formatRewriteResult(result: RewriteResult): string {
  if (!result.success) {
    return `Rewrite failed: ${result.changesDescription}`;
  }

  return [
    'Rewrite successful',
    '',
    '## Rewritten Content',
    result.rewrittenContent,
    '',
    '## Changes Made',
    result.changesDescription,
    '',
    `Cost: $${result.costUsd.toFixed(4)}`,
  ].join('\n');
}
