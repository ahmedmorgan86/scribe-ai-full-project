import { NextResponse } from 'next/server';
import { getAllCostSummaries, AggregatedCostSummary } from '@/lib/costs/tracker';

export interface CostsApiResponse {
  byApi: {
    apiName: string;
    dailyCost: number;
    monthlyCost: number;
    dailyLimit?: number;
    monthlyLimit?: number;
    dailyRemaining?: number;
    monthlyRemaining?: number;
    dailyPercentUsed?: number;
    monthlyPercentUsed?: number;
  }[];
  totalDailyCost: number;
  totalMonthlyCost: number;
  timestamp: string;
}

export function GET(): NextResponse<CostsApiResponse | { error: string }> {
  try {
    const summary: AggregatedCostSummary = getAllCostSummaries();

    const response: CostsApiResponse = {
      byApi: summary.byApi.map((api) => ({
        apiName: api.apiName,
        dailyCost: api.dailyCost,
        monthlyCost: api.monthlyCost,
        dailyLimit: api.dailyLimit,
        monthlyLimit: api.monthlyLimit,
        dailyRemaining: api.dailyRemaining,
        monthlyRemaining: api.monthlyRemaining,
        dailyPercentUsed: api.dailyPercentUsed,
        monthlyPercentUsed: api.monthlyPercentUsed,
      })),
      totalDailyCost: summary.totalDailyCost,
      totalMonthlyCost: summary.totalMonthlyCost,
      timestamp: summary.timestamp,
    };

    return NextResponse.json(response);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: `Failed to fetch costs: ${errorMessage}` }, { status: 500 });
  }
}
