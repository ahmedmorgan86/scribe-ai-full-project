import { NextResponse } from 'next/server';
import { listFormulas, createFormula, type CreateFormulaInput } from '@/db/models/formulas';
import type { Formula } from '@/types';

interface FormulasListResponse {
  formulas: Formula[];
  total: number;
}

interface ErrorResponse {
  error: string;
}

/**
 * GET /api/formulas
 * Returns all formulas
 */
export function GET(): NextResponse<FormulasListResponse | ErrorResponse> {
  try {
    const formulas = listFormulas({ limit: 100 });
    return NextResponse.json({
      formulas,
      total: formulas.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/formulas
 * Create a new formula
 */
export async function POST(
  request: Request
): Promise<NextResponse<{ success: boolean; formula: Formula } | ErrorResponse>> {
  try {
    const body = (await request.json()) as CreateFormulaInput;

    if (!body.name || !body.template) {
      return NextResponse.json({ error: 'Name and template are required' }, { status: 400 });
    }

    const formula = createFormula(body);
    return NextResponse.json({ success: true, formula });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
