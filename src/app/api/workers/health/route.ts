/**
 * Python Workers Health Check API Route
 *
 * Returns health status for all Python worker services:
 * - LiteLLM Gateway (port 8001)
 * - LangGraph Worker (port 8002)
 * - Stylometry Worker (port 8003)
 */

import { NextResponse } from 'next/server';
import {
  checkAllWorkersHealth,
  getWorkerUrls,
  type AllWorkersHealth,
  type WorkerServiceName,
} from '@/lib/workers/client';

export interface WorkerStatusResponse extends AllWorkersHealth {
  urls: Record<WorkerServiceName, string>;
}

export async function GET(): Promise<NextResponse<WorkerStatusResponse>> {
  const health = await checkAllWorkersHealth({ timeout: 5000 });
  const urls = getWorkerUrls();

  return NextResponse.json({
    ...health,
    urls,
  });
}
