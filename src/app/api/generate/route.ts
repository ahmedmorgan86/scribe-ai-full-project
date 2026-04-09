import { NextRequest, NextResponse } from 'next/server';
import { getSourceById } from '@/db/models/sources';
import { createPost } from '@/db/models/posts';
import { createQueueItem } from '@/db/models/queue';
import {
  generateContent as generateContentLegacy,
  toPost,
  GeneratorOptions,
  GenerationOutput,
} from '@/lib/generation/generator';
import {
  generateContent as generateContentLangGraph,
  isAvailableCached as isLangGraphAvailable,
  convertSourceToMaterial,
  convertResultToGenerationOutput,
} from '@/lib/generation/langgraph-client';
import { createLogger } from '@/lib/logger';
import type {
  Post,
  PostType,
  Source,
  PostReasoning,
  StoredVoiceEvaluation,
  SlopResult,
} from '@/types';

const logger = createLogger('api-generate');

type ContentTypeMapping = {
  single: 'standalone';
  thread: 'thread';
  quote: 'quote_tweet';
  reply: 'standalone';
};

const POST_TYPE_TO_CONTENT_TYPE: ContentTypeMapping = {
  single: 'standalone',
  thread: 'thread',
  quote: 'quote_tweet',
  reply: 'standalone',
};

interface GenerateRequestBody {
  sourceId: number;
  postType?: PostType;
  forceFormula?: string;
  skipVoiceValidation?: boolean;
  skipSlopDetection?: boolean;
  skipQuoteValueCheck?: boolean;
  skipDuplicateCheck?: boolean;
  maxRewriteAttempts?: number;
  addToQueue?: boolean;
  queuePriority?: number;
  useLangGraph?: boolean;
  debug?: boolean;
}

interface GenerateSuccessResponse {
  post: Post;
  generationDetails: {
    success: boolean;
    failureReason: string | null;
    formula: string | null;
    totalCostUsd: number;
    rewriteCount: number;
    flagForHumanReview: boolean;
    voiceScore: number | null;
    slopDetected: boolean;
    slopDetectors: string[];
  };
  addedToQueue: boolean;
  source: {
    id: number;
    sourceId: string;
    sourceType: string;
  };
  pipeline: 'legacy' | 'langgraph';
  langGraphJobId?: string;
  debugTrace?: Array<{
    node: string;
    message?: string;
    timestamp?: string;
    duration_ms?: number;
  }>;
}

interface ErrorResponse {
  error: string;
  code?: string;
}

const VALID_POST_TYPES: PostType[] = ['single', 'thread', 'quote', 'reply'];

function validateRequestBody(body: unknown): body is GenerateRequestBody {
  if (typeof body !== 'object' || body === null) {
    return false;
  }

  const obj = body as Record<string, unknown>;

  if (typeof obj.sourceId !== 'number' || !Number.isInteger(obj.sourceId) || obj.sourceId < 1) {
    return false;
  }

  if (obj.postType !== undefined && !VALID_POST_TYPES.includes(obj.postType as PostType)) {
    return false;
  }

  if (obj.forceFormula !== undefined && typeof obj.forceFormula !== 'string') {
    return false;
  }

  if (obj.skipVoiceValidation !== undefined && typeof obj.skipVoiceValidation !== 'boolean') {
    return false;
  }

  if (obj.skipSlopDetection !== undefined && typeof obj.skipSlopDetection !== 'boolean') {
    return false;
  }

  if (obj.skipQuoteValueCheck !== undefined && typeof obj.skipQuoteValueCheck !== 'boolean') {
    return false;
  }

  if (obj.skipDuplicateCheck !== undefined && typeof obj.skipDuplicateCheck !== 'boolean') {
    return false;
  }

  if (obj.maxRewriteAttempts !== undefined) {
    if (
      typeof obj.maxRewriteAttempts !== 'number' ||
      !Number.isInteger(obj.maxRewriteAttempts) ||
      obj.maxRewriteAttempts < 0 ||
      obj.maxRewriteAttempts > 5
    ) {
      return false;
    }
  }

  if (obj.addToQueue !== undefined && typeof obj.addToQueue !== 'boolean') {
    return false;
  }

  if (obj.queuePriority !== undefined) {
    if (typeof obj.queuePriority !== 'number' || !Number.isInteger(obj.queuePriority)) {
      return false;
    }
  }

  if (obj.useLangGraph !== undefined && typeof obj.useLangGraph !== 'boolean') {
    return false;
  }

  if (obj.debug !== undefined && typeof obj.debug !== 'boolean') {
    return false;
  }

  return true;
}

function buildGeneratorOptions(body: GenerateRequestBody): GeneratorOptions {
  return {
    postType: body.postType,
    forceFormula: body.forceFormula,
    skipVoiceValidation: body.skipVoiceValidation,
    skipSlopDetection: body.skipSlopDetection,
    skipQuoteValueCheck: body.skipQuoteValueCheck,
    skipDuplicateCheck: body.skipDuplicateCheck,
    maxRewriteAttempts: body.maxRewriteAttempts,
  };
}

function langGraphContentTypeToPostType(
  contentType: 'standalone' | 'thread' | 'quote_tweet'
): PostType {
  switch (contentType) {
    case 'standalone':
      return 'single';
    case 'thread':
      return 'thread';
    case 'quote_tweet':
      return 'quote';
    default:
      return 'single';
  }
}

function langGraphResultToGenerationOutput(
  result: ReturnType<typeof convertResultToGenerationOutput>
): GenerationOutput {
  const postType = langGraphContentTypeToPostType(result.contentType);

  const reasoning: PostReasoning = {
    source: result.reasoning.keyInsight,
    whyItWorks: result.reasoning.whyItWorks,
    voiceMatch: result.confidence.voice,
    timing: result.reasoning.timing,
    concerns: result.reasoning.concerns,
  };

  const voiceEvaluation: StoredVoiceEvaluation | null = result.success
    ? {
        passed: true,
        score: {
          voice: result.confidence.voice,
          hook: result.confidence.hook,
          topic: result.confidence.topic,
          originality: result.confidence.originality,
          overall: result.confidence.overall,
        },
        failureReasons: [],
        strengths: [],
        suggestions: [],
        stoppedAt: 'llm_eval' as const,
        costUsd: 0,
        evaluatedAt: new Date().toISOString(),
      }
    : null;

  const slopResult: SlopResult = {
    isSlop: false,
    detectedBy: [],
    flagForReview: false,
  };

  return {
    content: result.content ?? '',
    rawContent: result.content ?? '',
    humanizeResult: null,
    postType,
    reasoning,
    voiceEvaluation,
    slopResult,
    stylometricResult: null,
    stylometricSignature: null,
    quoteValueCheck: null,
    duplicateCheck: null,
    formula: null,
    totalCostUsd: 0,
    rewriteCount: result.rewriteCount,
    flagForHumanReview: !result.success,
    success: result.success,
    failureReason: result.failureReason,
    jobId: result.jobId,
  };
}

function buildSuccessResponse(
  post: Post,
  output: GenerationOutput,
  source: Source,
  addedToQueue: boolean,
  pipeline: 'legacy' | 'langgraph' = 'legacy',
  langGraphJobId?: string,
  debugTrace?: GenerateSuccessResponse['debugTrace']
): GenerateSuccessResponse {
  const response: GenerateSuccessResponse = {
    post,
    generationDetails: {
      success: output.success,
      failureReason: output.failureReason,
      formula: output.formula?.name ?? null,
      totalCostUsd: output.totalCostUsd,
      rewriteCount: output.rewriteCount,
      flagForHumanReview: output.flagForHumanReview,
      voiceScore: output.voiceEvaluation?.score?.overall ?? null,
      slopDetected: output.slopResult.isSlop,
      slopDetectors: output.slopResult.detectedBy,
    },
    addedToQueue,
    source: {
      id: source.id,
      sourceId: source.sourceId,
      sourceType: source.sourceType,
    },
    pipeline,
  };

  if (langGraphJobId) {
    response.langGraphJobId = langGraphJobId;
  }

  if (debugTrace) {
    response.debugTrace = debugTrace;
  }

  return response;
}

async function generateViaLangGraph(
  source: Source,
  body: GenerateRequestBody
): Promise<{
  output: GenerationOutput;
  jobId: string;
  debugTrace?: GenerateSuccessResponse['debugTrace'];
}> {
  const sourceMaterial = convertSourceToMaterial({
    id: source.id,
    source_type: source.sourceType,
    content: source.content,
    metadata:
      typeof source.metadata === 'string' ? source.metadata : JSON.stringify(source.metadata),
  });

  const contentType = body.postType ? POST_TYPE_TO_CONTENT_TYPE[body.postType] : 'standalone';

  const langGraphResult = await generateContentLangGraph({
    sources: [sourceMaterial],
    content_type: contentType,
    formula_id: body.forceFormula ?? null,
    max_rewrites: body.maxRewriteAttempts ?? 3,
    debug: body.debug === true,
  });

  const convertedResult = convertResultToGenerationOutput(langGraphResult);
  const output = langGraphResultToGenerationOutput(convertedResult);

  return {
    output,
    jobId: langGraphResult.id,
    debugTrace: langGraphResult.debug_trace ?? undefined,
  };
}

export async function POST(
  request: NextRequest
): Promise<NextResponse<GenerateSuccessResponse | ErrorResponse>> {
  try {
    const body = (await request.json()) as unknown;

    if (!validateRequestBody(body)) {
      return NextResponse.json(
        {
          error:
            'Invalid request body. Required: sourceId (positive integer). Optional: postType, forceFormula, skipVoiceValidation, skipSlopDetection, skipQuoteValueCheck, skipDuplicateCheck, maxRewriteAttempts (0-5), addToQueue, queuePriority, useLangGraph, debug.',
          code: 'INVALID_REQUEST',
        },
        { status: 400 }
      );
    }

    const source = getSourceById(body.sourceId);
    if (!source) {
      return NextResponse.json(
        {
          error: `Source with id ${body.sourceId} not found`,
          code: 'SOURCE_NOT_FOUND',
        },
        { status: 404 }
      );
    }

    let generationOutput: GenerationOutput;
    let usedPipeline: 'legacy' | 'langgraph' = 'legacy';
    let langGraphJobId: string | undefined;
    let debugTrace: GenerateSuccessResponse['debugTrace'] | undefined;

    const shouldUseLangGraph = body.useLangGraph === true;
    const langGraphAvailable = shouldUseLangGraph ? await isLangGraphAvailable() : false;

    if (shouldUseLangGraph && langGraphAvailable) {
      logger.info('Using LangGraph pipeline for generation', { sourceId: source.id });

      try {
        const langGraphResponse = await generateViaLangGraph(source, body);
        generationOutput = langGraphResponse.output;
        langGraphJobId = langGraphResponse.jobId;
        debugTrace = langGraphResponse.debugTrace;
        usedPipeline = 'langgraph';
      } catch (langGraphError) {
        logger.warn('LangGraph generation failed, falling back to legacy pipeline', {
          error: langGraphError,
          sourceId: source.id,
        });

        const options = buildGeneratorOptions(body);
        generationOutput = await generateContentLegacy(source, options);
        usedPipeline = 'legacy';
      }
    } else if (shouldUseLangGraph && !langGraphAvailable) {
      logger.warn('LangGraph requested but unavailable, using legacy pipeline', {
        sourceId: source.id,
      });

      const options = buildGeneratorOptions(body);
      generationOutput = await generateContentLegacy(source, options);
      usedPipeline = 'legacy';
    } else {
      const options = buildGeneratorOptions(body);
      generationOutput = await generateContentLegacy(source, options);
      usedPipeline = 'legacy';
    }

    const postData = toPost(generationOutput);
    const post = createPost({
      content: postData.content,
      type: postData.type,
      status: postData.status,
      confidenceScore: postData.confidenceScore,
      reasoning: postData.reasoning,
      voiceEvaluation: postData.voiceEvaluation ?? undefined,
      langGraphJobId: langGraphJobId,
    });

    let addedToQueue = false;
    const shouldAddToQueue = body.addToQueue ?? post.status === 'pending';
    if (shouldAddToQueue && post.status === 'pending') {
      createQueueItem({
        postId: post.id,
        priority: body.queuePriority ?? 0,
      });
      addedToQueue = true;
    }

    return NextResponse.json(
      buildSuccessResponse(
        post,
        generationOutput,
        source,
        addedToQueue,
        usedPipeline,
        langGraphJobId,
        debugTrace
      ),
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes('Budget exceeded')) {
      return NextResponse.json(
        {
          error: 'Budget limit exceeded. Cannot generate content.',
          code: 'BUDGET_EXCEEDED',
        },
        { status: 402 }
      );
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      {
        error: `Generation failed: ${errorMessage}`,
        code: 'GENERATION_ERROR',
      },
      { status: 500 }
    );
  }
}
