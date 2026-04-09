import type {
  Source,
  PostType,
  Post,
  PostReasoning,
  Formula,
  SlopResult,
  StoredVoiceEvaluation,
  StyleSignatureData,
  GenerationJob,
} from '@/types';
import { humanizeContent, type HumanizeResult } from '@/lib/humanizer/transform';
import {
  createGenerationJob,
  startGenerationJob,
  completeGenerationJob,
  failGenerationJob,
  updateGenerationJob,
} from '@/db/models/generation-jobs';
import { trackedCompletion } from '@/lib/anthropic/cost-tracking';
import {
  buildGenerationSystemPrompt,
  buildGenerationUserPrompt,
  GenerationContext,
} from '@/lib/anthropic/prompts/generation';
import { selectFormulaForContent } from '@/lib/formulas/loader';
import {
  formatGuidelinesForPrompt,
  getVoiceGuidelinesFromQdrant,
  hasVoiceGuidelines,
  VoiceGuidelines,
} from '@/lib/voice/guidelines';
import { validateVoice, toStoredVoiceEvaluation } from '@/lib/voice/validation-pipeline';
import {
  detectSlop,
  shouldTriggerRewrite,
  toSlopResult,
  DetailedSlopResult,
  needsHumanReview,
} from '@/lib/slop/detector';
import { rewriteSloppyContent, RewriteContext } from '@/lib/slop/rewrite';
import { getSimilarApprovedPosts } from '@/lib/voice/embeddings';
import { getPatternsForGeneration, formatPatternsForPrompt } from '@/lib/learning/patterns';
import { getRulesForGeneration } from '@/lib/learning/clarification-rules';
import { selectContentType } from './content-type-selector';
import { validateQuoteValue, QuoteValueCheckResult } from './quote-value-check';
import { checkForDuplicates, DuplicateCheckResult } from './duplicate-detection';
import {
  validate as validateStylometric,
  StylometricValidationResult,
} from '@/lib/voice/stylometric-validator';
import { generateSignature, StyleSignature } from '@/lib/voice/signature';

export interface GeneratorOptions {
  postType?: PostType;
  maxRewriteAttempts?: number;
  skipVoiceValidation?: boolean;
  skipSlopDetection?: boolean;
  skipStylometricValidation?: boolean;
  skipQuoteValueCheck?: boolean;
  skipDuplicateCheck?: boolean;
  forceFormula?: string;
  trackJob?: boolean;
}

export interface SourceAnalysis {
  keyInsight: string;
  suggestedPostType: PostType;
  contentHooks: string[];
  uniqueAngles: string[];
  timing: string;
  concerns: string[];
}

export interface GenerationOutput {
  content: string;
  rawContent: string;
  humanizeResult: HumanizeResult | null;
  postType: PostType;
  reasoning: PostReasoning;
  voiceEvaluation: StoredVoiceEvaluation | null;
  slopResult: SlopResult;
  stylometricResult: StylometricValidationResult | null;
  stylometricSignature: StyleSignatureData | null;
  quoteValueCheck: QuoteValueCheckResult | null;
  duplicateCheck: DuplicateCheckResult | null;
  formula: Formula | null;
  totalCostUsd: number;
  rewriteCount: number;
  flagForHumanReview: boolean;
  success: boolean;
  failureReason: string | null;
  jobId: string | null;
}

interface RawGenerationResponse {
  content: string;
  reasoning: {
    keyInsight: string;
    whyItWorks: string;
    timing: string;
    concerns: string[];
  };
}

function parseGenerationResponse(response: string, postType: PostType): RawGenerationResponse {
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as RawGenerationResponse;
      if (typeof parsed.content === 'string') {
        return {
          content: parsed.content.trim(),
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
    // Fall through to text extraction
  }

  const content = response.trim();
  return {
    content: postType === 'thread' ? content : content.slice(0, 280),
    reasoning: {
      keyInsight: 'Generated from source material',
      whyItWorks: 'Based on content formula and voice guidelines',
      timing: 'No specific timing',
      concerns: [],
    },
  };
}

function analyzeSource(source: Source): SourceAnalysis {
  const contentLower = source.content.toLowerCase();

  const contentTypeSelection = selectContentType(source);
  const suggestedPostType = contentTypeSelection.recommended;

  const contentHooks: string[] = [];
  const uniqueAngles: string[] = [];
  const concerns: string[] = [];

  if (contentLower.includes('problem') || contentLower.includes('struggle')) {
    contentHooks.push('Problem-focused opening');
  }
  if (contentLower.includes('solution') || contentLower.includes('solve')) {
    contentHooks.push('Solution-oriented hook');
  }
  if (contentLower.includes('secret') || contentLower.includes('hidden')) {
    contentHooks.push('Discovery/insider angle');
  }
  if (contentLower.includes('wrong') || contentLower.includes('myth')) {
    contentHooks.push('Contrarian take');
  }

  if (source.metadata.authorHandle) {
    uniqueAngles.push(`Perspective from @${source.metadata.authorHandle}`);
  }
  if (contentLower.includes('github') || contentLower.includes('repo')) {
    uniqueAngles.push('Tool/repo discovery angle');
  }
  if (contentLower.includes('learn') || contentLower.includes('lesson')) {
    uniqueAngles.push('Learning/teaching angle');
  }

  if (source.sourceType === 'account_tweet' && source.metadata.likeCount !== undefined) {
    if (source.metadata.likeCount > 1000) {
      concerns.push('High engagement source - ensure unique value add');
    }
  }

  for (const score of contentTypeSelection.scores) {
    if (score.type === suggestedPostType && score.reasons.length > 0) {
      concerns.push(`Content type rationale: ${score.reasons[0]}`);
      break;
    }
  }

  let timing = 'Evergreen content';
  if (
    contentLower.includes('just') ||
    contentLower.includes('today') ||
    contentLower.includes('breaking')
  ) {
    timing = 'Time-sensitive - consider posting soon';
  }

  const keyInsight = extractKeyInsight(source.content);

  return {
    keyInsight,
    suggestedPostType,
    contentHooks,
    uniqueAngles,
    timing,
    concerns,
  };
}

function extractKeyInsight(content: string): string {
  const sentences = content.split(/[.!?]+/).filter((s) => s.trim().length > 10);

  if (sentences.length === 0) {
    return content.slice(0, 200);
  }

  const prioritized = sentences.sort((a, b) => {
    let scoreA = 0;
    let scoreB = 0;

    const valuePhrases = ['key', 'important', 'crucial', 'secret', 'why', 'how'];
    for (const phrase of valuePhrases) {
      if (a.toLowerCase().includes(phrase)) scoreA += 10;
      if (b.toLowerCase().includes(phrase)) scoreB += 10;
    }

    if (a.includes(':')) scoreA += 5;
    if (b.includes(':')) scoreB += 5;

    scoreA -= Math.abs(a.length - 100) / 10;
    scoreB -= Math.abs(b.length - 100) / 10;

    return scoreB - scoreA;
  });

  return prioritized[0]?.trim() ?? content.slice(0, 200);
}

async function generateDraft(
  source: Source,
  context: GenerationContext
): Promise<{ content: string; reasoning: Partial<PostReasoning>; costUsd: number }> {
  const systemPrompt = buildGenerationSystemPrompt(context);
  const userPrompt = buildGenerationUserPrompt(context);

  const enhancedUserPrompt = `${userPrompt}

Return your response as JSON with this structure:
{
  "content": "the generated post content",
  "reasoning": {
    "keyInsight": "what key insight from the source you're capturing",
    "whyItWorks": "why this post will resonate with the audience",
    "timing": "any timing considerations",
    "concerns": ["any concerns or caveats"]
  }
}`;

  const result = await trackedCompletion(enhancedUserPrompt, {
    model: 'opus',
    systemPrompt,
    maxTokens: 2048,
    temperature: 0.7,
  });

  const parsed = parseGenerationResponse(result.content, context.postType);

  return {
    content: parsed.content,
    reasoning: {
      source: source.sourceId,
      whyItWorks: parsed.reasoning.whyItWorks,
      voiceMatch: 0,
      timing: parsed.reasoning.timing,
      concerns: parsed.reasoning.concerns,
    },
    costUsd: result.costUsd,
  };
}

async function getGenerationContext(
  source: Source,
  postType: PostType,
  forceFormula?: string
): Promise<{
  context: GenerationContext;
  formula: Formula | null;
  guidelines: VoiceGuidelines;
}> {
  const hasGuidelines = await hasVoiceGuidelines();
  const guidelines = hasGuidelines
    ? await getVoiceGuidelinesFromQdrant()
    : { dos: [], donts: [], examples: [], rules: [], raw: '' };

  const voiceGuidelinesText = formatGuidelinesForPrompt(guidelines);

  const storedPatterns = getPatternsForGeneration({
    types: ['voice', 'hook', 'topic', 'edit'],
    minEvidenceCount: 2,
    limit: 30,
  });
  const learnedPatternsFormatted = formatPatternsForPrompt(storedPatterns);

  const { rules: explicitRules, formatted: explicitRulesFormatted } = getRulesForGeneration();

  const learnedPatterns = storedPatterns.map((sp) => ({
    id: sp.id,
    patternType: sp.type,
    description: sp.description,
    evidenceCount: sp.evidenceCount,
    editEvidenceCount: sp.editEvidenceCount,
    rejectionEvidenceCount: sp.rejectionEvidenceCount,
    lastAccessedAt: sp.lastAccessedAt ?? null,
    accessCount: sp.accessCount ?? 0,
    decayScore: sp.decayScore ?? 1.0,
    status: sp.status ?? 'active',
    createdAt: sp.createdAt,
    updatedAt: sp.updatedAt,
  }));

  const similarPosts = await getSimilarApprovedPosts(source.content, {
    nResults: 5,
    threshold: 0.5,
  });
  const recentApprovedExamples = similarPosts.map((p) => p.content);

  let formula: Formula | null = null;
  if (forceFormula) {
    const matches = selectFormulaForContent(source.content, postType);
    formula = matches.find((m) => m.formula.name === forceFormula)?.formula ?? null;
  } else {
    const matches = selectFormulaForContent(source.content, postType);
    formula = matches[0]?.formula ?? null;
  }

  const context: GenerationContext = {
    voiceGuidelines: voiceGuidelinesText,
    formula,
    source,
    learnedPatterns,
    learnedPatternsFormatted,
    explicitRules,
    explicitRulesFormatted,
    recentApprovedExamples,
    postType,
  };

  return { context, formula, guidelines };
}

function styleSignatureToData(signature: StyleSignature): StyleSignatureData {
  return {
    sentenceLength: signature.sentenceLength,
    punctuation: signature.punctuation,
    vocabulary: signature.vocabulary,
    functionWords: signature.functionWords,
    syntactic: signature.syntactic,
    metadata: signature.metadata,
  };
}

async function runSlopDetectionAndRewrite(
  content: string,
  guidelines: VoiceGuidelines,
  maxRewriteAttempts: number
): Promise<{
  content: string;
  slopResult: DetailedSlopResult;
  rewriteCount: number;
  costUsd: number;
}> {
  let currentContent = content;
  let rewriteCount = 0;
  let totalCostUsd = 0;

  let slopResult = await detectSlop(currentContent);

  while (
    slopResult.isSlop &&
    shouldTriggerRewrite(slopResult) &&
    rewriteCount < maxRewriteAttempts
  ) {
    const similarPosts = await getSimilarApprovedPosts(currentContent, {
      nResults: 3,
      threshold: 0.5,
    });

    const rewriteContext: RewriteContext = {
      voiceGuidelines: formatGuidelinesForPrompt(guidelines),
      approvedExamples: similarPosts.map((p) => p.content),
    };

    const rewriteResult = await rewriteSloppyContent(currentContent, slopResult, rewriteContext);
    totalCostUsd += rewriteResult.costUsd;

    if (rewriteResult.success) {
      currentContent = rewriteResult.rewrittenContent;
      rewriteCount++;
      slopResult = await detectSlop(currentContent);
    } else {
      break;
    }
  }

  return {
    content: currentContent,
    slopResult,
    rewriteCount,
    costUsd: totalCostUsd,
  };
}

export async function generateContent(
  source: Source,
  options: GeneratorOptions = {}
): Promise<GenerationOutput> {
  const {
    maxRewriteAttempts = 2,
    skipVoiceValidation = false,
    skipSlopDetection = false,
    skipStylometricValidation = false,
    skipQuoteValueCheck = false,
    skipDuplicateCheck = false,
    forceFormula,
    trackJob = true,
  } = options;

  const sourceAnalysis = analyzeSource(source);
  const postType = options.postType ?? sourceAnalysis.suggestedPostType;

  let job: GenerationJob | null = null;
  if (trackJob) {
    job = createGenerationJob({
      pipeline: 'typescript',
      sourceIds: [source.id],
      contentType: postType,
      metadata: { forceFormula, maxRewriteAttempts },
    });
    startGenerationJob(job.id);
  }

  try {
    let totalCostUsd = 0;

    const { context, formula, guidelines } = await getGenerationContext(
      source,
      postType,
      forceFormula
    );

    const draftResult = await generateDraft(source, context);
    totalCostUsd += draftResult.costUsd;

    // Store raw content before humanization
    const rawContent = draftResult.content;

    // Apply humanizer patterns to content
    const humanizeResult = humanizeContent(rawContent);
    let currentContent = humanizeResult.humanized;

    let rewriteCount = 0;
    let slopResult: DetailedSlopResult = {
      isSlop: false,
      detectedBy: [],
      flagForReview: false,
      issues: [],
      suggestions: [],
    };

    if (!skipSlopDetection) {
      const slopAndRewrite = await runSlopDetectionAndRewrite(
        currentContent,
        guidelines,
        maxRewriteAttempts
      );
      currentContent = slopAndRewrite.content;
      slopResult = slopAndRewrite.slopResult;
      rewriteCount = slopAndRewrite.rewriteCount;
      totalCostUsd += slopAndRewrite.costUsd;
    }

    let stylometricResult: StylometricValidationResult | null = null;
    let stylometricSignature: StyleSignatureData | null = null;
    if (!skipStylometricValidation) {
      stylometricResult = await validateStylometric(currentContent);
      const signature = generateSignature(currentContent);
      stylometricSignature = styleSignatureToData(signature);
    }

    let voiceEvaluation: StoredVoiceEvaluation | null = null;
    if (!skipVoiceValidation) {
      const validationResult = await validateVoice(currentContent);
      voiceEvaluation = toStoredVoiceEvaluation(validationResult);
      totalCostUsd += validationResult.costUsd;
    }

    let quoteValueCheck: QuoteValueCheckResult | null = null;
    if (postType === 'quote' && !skipQuoteValueCheck) {
      quoteValueCheck = await validateQuoteValue(currentContent, source.content, {
        useLlm: true,
        source,
      });
      totalCostUsd += quoteValueCheck.costUsd;
    }

    let duplicateCheck: DuplicateCheckResult | null = null;
    if (!skipDuplicateCheck) {
      duplicateCheck = await checkForDuplicates(currentContent);
    }

    const flagForHumanReview = needsHumanReview(slopResult);
    const quoteValuePassed = postType !== 'quote' || quoteValueCheck?.addsValue !== false;
    const stylometricPassed = stylometricResult?.pass ?? true;
    const success =
      !slopResult.isSlop &&
      (voiceEvaluation?.passed ?? true) &&
      quoteValuePassed &&
      stylometricPassed;

    const reasoning: PostReasoning = {
      source: source.sourceId,
      whyItWorks: draftResult.reasoning.whyItWorks ?? sourceAnalysis.keyInsight,
      voiceMatch: voiceEvaluation?.score?.overall ?? 0,
      timing: sourceAnalysis.timing,
      concerns: [
        ...sourceAnalysis.concerns,
        ...(draftResult.reasoning.concerns ?? []),
        ...(voiceEvaluation?.failureReasons ?? []),
        ...(stylometricResult && !stylometricResult.pass
          ? [`Stylometric: ${stylometricResult.feedback}`]
          : []),
        ...(quoteValueCheck?.issues.map((i) => `Quote value: ${i.description}`) ?? []),
        ...(duplicateCheck?.warning ? [`Duplicate warning: ${duplicateCheck.warning}`] : []),
      ],
    };

    let failureReason: string | null = null;
    if (!success) {
      if (slopResult.isSlop) {
        failureReason = 'Content flagged as slop';
      } else if (!stylometricPassed) {
        failureReason = `Stylometric validation failed: ${stylometricResult?.feedback ?? 'Style mismatch'}`;
      } else if (!quoteValuePassed) {
        failureReason = 'Quote tweet does not add unique value';
      } else {
        failureReason = 'Voice validation failed';
      }
    }

    if (job) {
      if (success) {
        completeGenerationJob(job.id);
      } else {
        failGenerationJob(job.id, failureReason ?? 'Unknown failure');
      }
      updateGenerationJob(job.id, {
        metadata: {
          forceFormula,
          maxRewriteAttempts,
          rewriteCount,
          totalCostUsd,
          success,
        },
      });
    }

    return {
      content: currentContent,
      rawContent,
      humanizeResult,
      postType,
      reasoning,
      voiceEvaluation,
      slopResult: toSlopResult(slopResult),
      stylometricResult,
      stylometricSignature,
      quoteValueCheck,
      duplicateCheck,
      formula,
      totalCostUsd,
      rewriteCount,
      flagForHumanReview,
      success,
      failureReason,
      jobId: job?.id ?? null,
    };
  } catch (error) {
    if (job) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      failGenerationJob(job.id, errorMessage);
    }
    throw error;
  }
}

export function toPost(
  output: GenerationOutput
): Omit<Post, 'id' | 'createdAt' | 'postedAt' | 'copiedAt'> {
  return {
    content: output.content,
    type: output.postType,
    status: output.flagForHumanReview ? 'draft' : output.success ? 'pending' : 'draft',
    confidenceScore: output.voiceEvaluation?.score?.overall ?? 0,
    reasoning: output.reasoning,
    voiceEvaluation: output.voiceEvaluation,
    stylometricSignature: output.stylometricSignature,
    langGraphJobId: null,
    rejectionReason: null,
    rejectionComment: null,
    rejectedAt: null,
  };
}

export function formatGenerationOutput(output: GenerationOutput): string {
  const lines: string[] = [];

  lines.push(`=== GENERATION ${output.success ? 'SUCCESS' : 'INCOMPLETE'} ===`);
  lines.push('');
  lines.push(`Post Type: ${output.postType}`);
  lines.push(`Formula: ${output.formula?.name ?? 'None'}`);
  lines.push(`Rewrite Count: ${output.rewriteCount}`);
  lines.push(`Total Cost: $${output.totalCostUsd.toFixed(4)}`);
  lines.push('');

  lines.push('--- CONTENT ---');
  lines.push(output.content);
  lines.push('');

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
    lines.push(`  Voice: ${output.voiceEvaluation.score.voice}`);
    lines.push(`  Hook: ${output.voiceEvaluation.score.hook}`);
    lines.push(`  Topic: ${output.voiceEvaluation.score.topic}`);
    lines.push(`  Originality: ${output.voiceEvaluation.score.originality}`);
    lines.push('');
  }

  lines.push('--- SLOP DETECTION ---');
  lines.push(`Is Slop: ${output.slopResult.isSlop}`);
  lines.push(`Detected By: ${output.slopResult.detectedBy.join(', ') || 'None'}`);
  lines.push(`Flag for Review: ${output.flagForHumanReview}`);

  if (output.stylometricResult) {
    lines.push('');
    lines.push('--- STYLOMETRIC VALIDATION ---');
    lines.push(`Passed: ${output.stylometricResult.pass}`);
    lines.push(`Score: ${Math.round(output.stylometricResult.score * 100)}%`);
    lines.push(`Threshold: ${Math.round(output.stylometricResult.threshold * 100)}%`);
    lines.push('Dimension Scores:');
    const dims = output.stylometricResult.dimensionScores;
    lines.push(`  Sentence Length: ${Math.round(dims.sentenceLength * 100)}%`);
    lines.push(`  Punctuation: ${Math.round(dims.punctuation * 100)}%`);
    lines.push(`  Vocabulary: ${Math.round(dims.vocabulary * 100)}%`);
    lines.push(`  Function Words: ${Math.round(dims.functionWords * 100)}%`);
    lines.push(`  Syntactic: ${Math.round(dims.syntactic * 100)}%`);
    if (!output.stylometricResult.pass) {
      lines.push(`Feedback: ${output.stylometricResult.feedback}`);
    }
  }

  if (output.quoteValueCheck) {
    lines.push('');
    lines.push('--- QUOTE VALUE CHECK ---');
    lines.push(`Adds Value: ${output.quoteValueCheck.addsValue}`);
    lines.push(`Value Type: ${output.quoteValueCheck.valueType ?? 'None detected'}`);
    lines.push(`Score: ${output.quoteValueCheck.score}/100`);
    if (output.quoteValueCheck.issues.length > 0) {
      lines.push('Issues:');
      for (const issue of output.quoteValueCheck.issues) {
        lines.push(`  [${issue.severity.toUpperCase()}] ${issue.description}`);
      }
    }
    if (output.quoteValueCheck.suggestions.length > 0) {
      lines.push('Suggestions:');
      for (const suggestion of output.quoteValueCheck.suggestions) {
        lines.push(`  - ${suggestion}`);
      }
    }
  }

  if (output.duplicateCheck) {
    lines.push('');
    lines.push('--- DUPLICATE CHECK ---');
    lines.push(`Is Duplicate: ${output.duplicateCheck.isDuplicate}`);
    lines.push(`Highest Similarity: ${Math.round(output.duplicateCheck.highestSimilarity * 100)}%`);
    if (output.duplicateCheck.warning) {
      lines.push(`Warning: ${output.duplicateCheck.warning}`);
    }
    if (output.duplicateCheck.matches.length > 0) {
      lines.push('Similar content found:');
      for (const match of output.duplicateCheck.matches.slice(0, 3)) {
        const percent = Math.round(match.similarity * 100);
        const preview =
          match.content.length > 50 ? match.content.slice(0, 50) + '...' : match.content;
        lines.push(`  [${percent}%] ${match.source} #${match.postId}: "${preview}"`);
      }
    }
  }

  if (output.failureReason) {
    lines.push('');
    lines.push(`*** FAILURE: ${output.failureReason} ***`);
  }

  return lines.join('\n');
}

export { analyzeSource, selectContentType };
