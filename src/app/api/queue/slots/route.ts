import { NextRequest, NextResponse } from 'next/server';
import {
  QueueSlot,
  createQueueSlot,
  listQueueSlots,
  updateQueueSlot,
  deleteQueueSlot,
  getNextAvailableSlot,
  seedDefaultSlots,
} from '@/db/models/queue-slots';

interface SlotsListResponse {
  slots: QueueSlot[];
  nextAvailable: string | null;
}

interface ErrorResponse {
  error: string;
}

interface CreateSlotBody {
  dayOfWeek: number;
  timeUtc: string;
  enabled?: boolean;
}

interface UpdateSlotBody {
  id: string;
  dayOfWeek?: number;
  timeUtc?: string;
  enabled?: boolean;
}

interface DeleteSlotBody {
  id: string;
}

export function GET(): NextResponse<SlotsListResponse | ErrorResponse> {
  try {
    const slots = listQueueSlots();
    const nextAvailable = getNextAvailableSlot();

    return NextResponse.json({
      slots,
      nextAvailable: nextAvailable?.toISOString() ?? null,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest
): Promise<NextResponse<{ slot: QueueSlot } | { seeded: number } | ErrorResponse>> {
  try {
    const body = (await request.json()) as CreateSlotBody | { action: string };

    // Handle seed action
    if ('action' in body && body.action === 'seed') {
      const seeded = seedDefaultSlots();
      return NextResponse.json({ seeded }, { status: 201 });
    }

    const createBody = body as CreateSlotBody;

    // Validate dayOfWeek
    if (
      typeof createBody.dayOfWeek !== 'number' ||
      createBody.dayOfWeek < 0 ||
      createBody.dayOfWeek > 6
    ) {
      return NextResponse.json(
        { error: 'dayOfWeek is required and must be 0-6 (Sunday-Saturday)' },
        { status: 400 }
      );
    }

    // Validate timeUtc format (HH:mm)
    if (typeof createBody.timeUtc !== 'string' || !/^\d{2}:\d{2}$/.test(createBody.timeUtc)) {
      return NextResponse.json(
        { error: 'timeUtc is required and must be in HH:mm format' },
        { status: 400 }
      );
    }

    const slot = createQueueSlot({
      dayOfWeek: createBody.dayOfWeek,
      timeUtc: createBody.timeUtc,
      enabled: createBody.enabled,
    });

    return NextResponse.json({ slot }, { status: 201 });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest
): Promise<NextResponse<{ slot: QueueSlot } | ErrorResponse>> {
  try {
    const body = (await request.json()) as UpdateSlotBody;

    if (typeof body.id !== 'string' || body.id.length === 0) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    // Validate dayOfWeek if provided
    if (body.dayOfWeek !== undefined && (body.dayOfWeek < 0 || body.dayOfWeek > 6)) {
      return NextResponse.json(
        { error: 'dayOfWeek must be 0-6 (Sunday-Saturday)' },
        { status: 400 }
      );
    }

    // Validate timeUtc format if provided
    if (body.timeUtc !== undefined && !/^\d{2}:\d{2}$/.test(body.timeUtc)) {
      return NextResponse.json({ error: 'timeUtc must be in HH:mm format' }, { status: 400 });
    }

    const slot = updateQueueSlot(body.id, {
      dayOfWeek: body.dayOfWeek,
      timeUtc: body.timeUtc,
      enabled: body.enabled,
    });

    if (!slot) {
      return NextResponse.json({ error: 'Slot not found' }, { status: 404 });
    }

    return NextResponse.json({ slot });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest
): Promise<NextResponse<{ success: boolean } | ErrorResponse>> {
  try {
    const body = (await request.json()) as DeleteSlotBody;

    if (typeof body.id !== 'string' || body.id.length === 0) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const deleted = deleteQueueSlot(body.id);

    if (!deleted) {
      return NextResponse.json({ error: 'Slot not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
