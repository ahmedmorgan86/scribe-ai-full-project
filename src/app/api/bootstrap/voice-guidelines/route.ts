import { NextResponse } from 'next/server';
import {
  parseVoiceGuidelinesMarkdown,
  syncVoiceGuidelinesToQdrant,
  getVoiceGuidelinesFromQdrant,
  formatGuidelinesForPrompt,
} from '@/lib/voice/guidelines';

interface VoiceGuidelinesRequest {
  content: string;
}

interface VoiceGuidelinesResponse {
  success: boolean;
  parsed: {
    dosCount: number;
    dontsCount: number;
    examplesCount: number;
    rulesCount: number;
  };
}

interface GetVoiceGuidelinesResponse {
  hasGuidelines: boolean;
  guidelines: {
    dos: string[];
    donts: string[];
    examples: string[];
    rules: string[];
  };
  formatted: string;
  counts: {
    dos: number;
    donts: number;
    examples: number;
    rules: number;
    total: number;
  };
}

interface ErrorResponse {
  error: string;
}

export async function GET(): Promise<NextResponse<GetVoiceGuidelinesResponse | ErrorResponse>> {
  try {
    const guidelines = await getVoiceGuidelinesFromQdrant();

    const total =
      guidelines.dos.length +
      guidelines.donts.length +
      guidelines.examples.length +
      guidelines.rules.length;

    return NextResponse.json({
      hasGuidelines: total > 0,
      guidelines: {
        dos: guidelines.dos,
        donts: guidelines.donts,
        examples: guidelines.examples,
        rules: guidelines.rules,
      },
      formatted: total > 0 ? formatGuidelinesForPrompt(guidelines) : '',
      counts: {
        dos: guidelines.dos.length,
        donts: guidelines.donts.length,
        examples: guidelines.examples.length,
        rules: guidelines.rules.length,
        total,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

interface DeleteGuidelineRequest {
  type: 'dos' | 'donts' | 'examples' | 'rules';
  index: number;
}

/**
 * DELETE /api/bootstrap/voice-guidelines
 * Deletes a specific guideline by type and index
 */
export async function DELETE(
  request: Request
): Promise<NextResponse<{ success: boolean } | ErrorResponse>> {
  try {
    const body = (await request.json()) as DeleteGuidelineRequest;
    const { type, index } = body;

    if (!type || typeof index !== 'number') {
      return NextResponse.json({ error: 'Type and index are required' }, { status: 400 });
    }

    // Map frontend type names to backend type names
    const typeMap: Record<string, string> = {
      dos: 'do',
      donts: 'dont',
      examples: 'example',
      rules: 'rule',
    };

    const guidelineType = typeMap[type];
    if (!guidelineType) {
      return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
    }

    // Get current guidelines to find the item to delete
    const guidelines = await getVoiceGuidelinesFromQdrant();
    const items = guidelines[type as keyof typeof guidelines] as string[];

    if (index < 0 || index >= items.length) {
      return NextResponse.json({ error: 'Index out of range' }, { status: 400 });
    }

    const contentToDelete = items[index];

    // Delete by content match using Qdrant
    const { QDRANT_COLLECTION_NAMES, collectionExists } = await import('@/db/qdrant/connection');

    const exists = await collectionExists(QDRANT_COLLECTION_NAMES.VOICE_GUIDELINES);
    if (!exists) {
      return NextResponse.json({ error: 'Collection does not exist' }, { status: 404 });
    }

    // Find and delete the specific point by content match
    const { getQdrantClient } = await import('@/db/qdrant/connection');
    const client = getQdrantClient();

    // Scroll to find the point with matching content
    const scrollResult = await client.scroll(QDRANT_COLLECTION_NAMES.VOICE_GUIDELINES, {
      filter: {
        must: [{ key: 'guideline_type', match: { value: guidelineType } }],
      },
      with_payload: true,
      limit: 1000,
    });

    const pointToDelete = scrollResult.points.find(
      (p) => (p.payload?.text as string) === contentToDelete
    );

    if (!pointToDelete) {
      return NextResponse.json({ error: 'Guideline not found' }, { status: 404 });
    }

    // Delete the specific point
    await client.delete(QDRANT_COLLECTION_NAMES.VOICE_GUIDELINES, {
      points: [pointToDelete.id],
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  request: Request
): Promise<NextResponse<VoiceGuidelinesResponse | ErrorResponse>> {
  try {
    const body = (await request.json()) as VoiceGuidelinesRequest;

    if (!body.content || typeof body.content !== 'string') {
      return NextResponse.json({ error: 'Content is required' }, { status: 400 });
    }

    const guidelines = parseVoiceGuidelinesMarkdown(body.content);

    if (
      guidelines.dos.length === 0 &&
      guidelines.donts.length === 0 &&
      guidelines.examples.length === 0 &&
      guidelines.rules.length === 0
    ) {
      return NextResponse.json(
        {
          error:
            'No guidelines found. Make sure to use markdown headers like "## DO\'s", "## DON\'Ts", "## Examples", "## Rules"',
        },
        { status: 400 }
      );
    }

    await syncVoiceGuidelinesToQdrant(guidelines);

    return NextResponse.json({
      success: true,
      parsed: {
        dosCount: guidelines.dos.length,
        dontsCount: guidelines.donts.length,
        examplesCount: guidelines.examples.length,
        rulesCount: guidelines.rules.length,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
