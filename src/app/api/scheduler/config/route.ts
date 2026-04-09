import { NextRequest, NextResponse } from 'next/server';
import {
  getSchedulerConfig,
  updateSchedulerConfig,
  type SourceMode,
  type SchedulerConfig,
  type UpdateSchedulerConfigInput,
} from '@/db/models/scheduler-config';

export const dynamic = 'force-dynamic';

interface ErrorResponse {
  error: string;
}

const VALID_SOURCE_MODES: SourceMode[] = ['round_robin', 'random', 'weighted', 'manual'];

export function GET(): NextResponse<SchedulerConfig | ErrorResponse> {
  try {
    const config = getSchedulerConfig();
    return NextResponse.json(config);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

interface UpdateConfigBody {
  enabled?: boolean;
  intervalMinutes?: number;
  maxQueueSize?: number;
  sourceMode?: SourceMode;
  manualSourceIds?: number[] | null;
  timeSlots?: string[] | null;
}

export async function PATCH(
  request: NextRequest
): Promise<NextResponse<SchedulerConfig | ErrorResponse>> {
  try {
    const body = (await request.json()) as UpdateConfigBody;

    const updates: UpdateSchedulerConfigInput = {};

    if (body.enabled !== undefined) {
      if (typeof body.enabled !== 'boolean') {
        return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 });
      }
      updates.enabled = body.enabled;
    }

    if (body.intervalMinutes !== undefined) {
      if (
        typeof body.intervalMinutes !== 'number' ||
        !Number.isInteger(body.intervalMinutes) ||
        body.intervalMinutes < 1 ||
        body.intervalMinutes > 1440
      ) {
        return NextResponse.json(
          { error: 'intervalMinutes must be an integer between 1 and 1440' },
          { status: 400 }
        );
      }
      updates.intervalMinutes = body.intervalMinutes;
    }

    if (body.maxQueueSize !== undefined) {
      if (
        typeof body.maxQueueSize !== 'number' ||
        !Number.isInteger(body.maxQueueSize) ||
        body.maxQueueSize < 1 ||
        body.maxQueueSize > 100
      ) {
        return NextResponse.json(
          { error: 'maxQueueSize must be an integer between 1 and 100' },
          { status: 400 }
        );
      }
      updates.maxQueueSize = body.maxQueueSize;
    }

    if (body.sourceMode !== undefined) {
      if (!VALID_SOURCE_MODES.includes(body.sourceMode)) {
        return NextResponse.json(
          { error: `sourceMode must be one of: ${VALID_SOURCE_MODES.join(', ')}` },
          { status: 400 }
        );
      }
      updates.sourceMode = body.sourceMode;
    }

    if (body.manualSourceIds !== undefined) {
      if (
        body.manualSourceIds !== null &&
        (!Array.isArray(body.manualSourceIds) ||
          !body.manualSourceIds.every((id) => typeof id === 'number' && Number.isInteger(id)))
      ) {
        return NextResponse.json(
          { error: 'manualSourceIds must be null or an array of integers' },
          { status: 400 }
        );
      }
      updates.manualSourceIds = body.manualSourceIds;
    }

    if (body.timeSlots !== undefined) {
      if (body.timeSlots !== null) {
        if (!Array.isArray(body.timeSlots)) {
          return NextResponse.json(
            { error: 'timeSlots must be null or an array of time strings (HH:MM)' },
            { status: 400 }
          );
        }
        // Validate time format
        const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
        for (const slot of body.timeSlots) {
          if (typeof slot !== 'string' || !timeRegex.test(slot)) {
            return NextResponse.json(
              { error: `Invalid time slot format: ${slot}. Use HH:MM format.` },
              { status: 400 }
            );
          }
        }
      }
      updates.timeSlots = body.timeSlots;
    }

    const config = updateSchedulerConfig(updates);
    return NextResponse.json(config);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
