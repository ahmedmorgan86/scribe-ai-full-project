import { NextResponse } from 'next/server';
import {
  getFormulaById,
  updateFormula,
  deleteFormula,
  type UpdateFormulaInput,
} from '@/db/models/formulas';
import type { Formula } from '@/types';

interface ErrorResponse {
  error: string;
}

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/formulas/[id]
 * Get a single formula by ID
 */
export async function GET(
  _request: Request,
  context: RouteContext
): Promise<NextResponse<Formula | ErrorResponse>> {
  try {
    const { id } = await context.params;
    const formulaId = parseInt(id, 10);

    if (isNaN(formulaId)) {
      return NextResponse.json({ error: 'Invalid formula ID' }, { status: 400 });
    }

    const formula = getFormulaById(formulaId);
    if (!formula) {
      return NextResponse.json({ error: 'Formula not found' }, { status: 404 });
    }

    return NextResponse.json(formula);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * PATCH /api/formulas/[id]
 * Update a formula
 */
export async function PATCH(
  request: Request,
  context: RouteContext
): Promise<NextResponse<{ success: boolean; formula: Formula } | ErrorResponse>> {
  try {
    const { id } = await context.params;
    const formulaId = parseInt(id, 10);

    if (isNaN(formulaId)) {
      return NextResponse.json({ error: 'Invalid formula ID' }, { status: 400 });
    }

    const body = (await request.json()) as UpdateFormulaInput;
    const formula = updateFormula(formulaId, body);

    if (!formula) {
      return NextResponse.json({ error: 'Formula not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, formula });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/formulas/[id]
 * Delete a formula
 */
export async function DELETE(
  _request: Request,
  context: RouteContext
): Promise<NextResponse<{ success: boolean } | ErrorResponse>> {
  try {
    const { id } = await context.params;
    const formulaId = parseInt(id, 10);

    if (isNaN(formulaId)) {
      return NextResponse.json({ error: 'Invalid formula ID' }, { status: 400 });
    }

    const deleted = deleteFormula(formulaId);
    if (!deleted) {
      return NextResponse.json({ error: 'Formula not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
