import { NextRequest, NextResponse } from 'next/server';
import {
  checkStylometricDrift,
  DEFAULT_DRIFT_THRESHOLD,
  DriftAnalysisResult,
} from '@/lib/voice/signature';
import { sendNotification, isDiscordConfigured } from '@/lib/notifications/discord';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api:stylometric-drift');

export interface DriftCheckResponse extends DriftAnalysisResult {
  checkedAt: string;
  notificationSent: boolean;
}

export async function GET(request: NextRequest): Promise<NextResponse<DriftCheckResponse>> {
  const { searchParams } = new URL(request.url);
  const thresholdParam = searchParams.get('threshold');
  const countParam = searchParams.get('count');
  const notify = searchParams.get('notify') !== 'false';

  const threshold = thresholdParam ? parseFloat(thresholdParam) : DEFAULT_DRIFT_THRESHOLD;
  const recentPostsCount = countParam ? parseInt(countParam, 10) : undefined;

  try {
    const result = await checkStylometricDrift({ threshold, recentPostsCount });

    let notificationSent = false;

    if (result.hasDrift && notify && isDiscordConfigured()) {
      const urgency = result.alertLevel === 'critical' ? 'high' : 'medium';
      const title =
        result.alertLevel === 'critical'
          ? 'Critical Stylometric Drift'
          : 'Stylometric Drift Warning';

      const driftPct = (result.driftPercentage * 100).toFixed(1);
      const message = `Recent posts are drifting ${driftPct}% from baseline voice (threshold: ${(threshold * 100).toFixed(0)}%)`;

      const fields = result.dimensionDrifts
        ? [
            {
              name: 'Dimension Drifts',
              value: Object.entries(result.dimensionDrifts)
                .map(([k, v]) => `${k}: ${(v * 100).toFixed(0)}%`)
                .join(', '),
              inline: false,
            },
            {
              name: 'Recent Posts Analyzed',
              value: String(result.recentPostsCount),
              inline: true,
            },
            {
              name: 'Alert Level',
              value: result.alertLevel.toUpperCase(),
              inline: true,
            },
          ]
        : undefined;

      if (result.feedback.length > 0) {
        fields?.push({
          name: 'Issues',
          value: result.feedback.join('\n'),
          inline: false,
        });
      }

      const sendResult = await sendNotification('agent_stuck', title, message, urgency, fields);
      notificationSent = sendResult.success;

      if (!sendResult.success) {
        logger.warn('Failed to send drift notification', { error: sendResult.error });
      }
    }

    logger.info('Stylometric drift check completed', {
      hasDrift: result.hasDrift,
      driftPercentage: result.driftPercentage,
      alertLevel: result.alertLevel,
    });

    return NextResponse.json({
      ...result,
      checkedAt: new Date().toISOString(),
      notificationSent,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Stylometric drift check failed', { error: message });

    return NextResponse.json(
      {
        hasDrift: false,
        driftPercentage: 0,
        threshold,
        recentPostsCount: 0,
        recentSignature: null,
        baselineSignature: null,
        dimensionDrifts: null,
        feedback: [`Error: ${message}`],
        alertLevel: 'none' as const,
        checkedAt: new Date().toISOString(),
        notificationSent: false,
      },
      { status: 500 }
    );
  }
}
