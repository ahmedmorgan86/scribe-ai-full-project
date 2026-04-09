import { NextResponse } from 'next/server';
import { getDashboardConfigStatus } from '@/lib/config/status-validator';

export async function GET(): Promise<NextResponse> {
  try {
    const status = await getDashboardConfigStatus();
    return NextResponse.json(status);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
