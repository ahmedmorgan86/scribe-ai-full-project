'use client';

export type AlertType = 'info' | 'warning' | 'error' | 'success';

export interface Alert {
  id: string;
  type: AlertType;
  title?: string;
  message: string;
  timestamp: string;
  source?: AlertSource;
  action?: AlertAction;
}

export type AlertSource = 'budget' | 'scraping' | 'generation' | 'voice' | 'learning' | 'system';

export interface AlertAction {
  label: string;
  href?: string;
  onClick?: () => void;
}

interface AlertsProps {
  alerts: Alert[];
  onDismiss: (id: string) => void;
  maxVisible?: number;
}

const ALERT_CONFIG: Record<
  AlertType,
  { bg: string; border: string; icon: string; iconColor: string }
> = {
  info: {
    bg: 'bg-blue-900/20',
    border: 'border-blue-500/50',
    icon: 'ℹ',
    iconColor: 'text-blue-400',
  },
  warning: {
    bg: 'bg-yellow-900/20',
    border: 'border-yellow-500/50',
    icon: '⚠',
    iconColor: 'text-yellow-400',
  },
  error: {
    bg: 'bg-red-900/20',
    border: 'border-red-500/50',
    icon: '✕',
    iconColor: 'text-red-400',
  },
  success: {
    bg: 'bg-green-900/20',
    border: 'border-green-500/50',
    icon: '✓',
    iconColor: 'text-green-400',
  },
};

export function Alerts({ alerts, onDismiss, maxVisible = 5 }: AlertsProps): React.ReactElement {
  if (alerts.length === 0) {
    return <EmptyAlerts />;
  }

  const visibleAlerts = alerts.slice(0, maxVisible);
  const hiddenCount = alerts.length - maxVisible;

  return (
    <div className="space-y-2">
      {visibleAlerts.map((alert) => (
        <AlertItem key={alert.id} alert={alert} onDismiss={onDismiss} />
      ))}
      {hiddenCount > 0 && (
        <div className="text-center text-sm text-gray-500 py-2">
          +{hiddenCount} more alert{hiddenCount > 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}

interface AlertItemProps {
  alert: Alert;
  onDismiss: (id: string) => void;
}

function AlertItem({ alert, onDismiss }: AlertItemProps): React.ReactElement {
  const config = ALERT_CONFIG[alert.type];

  return (
    <div
      className={`flex items-start space-x-3 p-3 rounded-lg border ${config.bg} ${config.border}`}
      role="alert"
    >
      <span className={`flex-shrink-0 ${config.iconColor}`} aria-hidden="true">
        {config.icon}
      </span>
      <div className="flex-1 min-w-0">
        {alert.title && <p className="text-sm font-medium text-white">{alert.title}</p>}
        <p className={`text-sm text-gray-300 ${alert.title ? 'mt-0.5' : ''}`}>{alert.message}</p>
        <div className="flex items-center space-x-3 mt-1.5">
          <span className="text-xs text-gray-500">{formatTimestamp(alert.timestamp)}</span>
          {alert.source && <SourceBadge source={alert.source} />}
          {alert.action && <ActionButton action={alert.action} />}
        </div>
      </div>
      <button
        onClick={(): void => onDismiss(alert.id)}
        className="flex-shrink-0 text-gray-500 hover:text-white transition-colors p-1 -m-1"
        aria-label="Dismiss alert"
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}

interface SourceBadgeProps {
  source: AlertSource;
}

function SourceBadge({ source }: SourceBadgeProps): React.ReactElement {
  const sourceLabels: Record<AlertSource, string> = {
    budget: 'Budget',
    scraping: 'Scraping',
    generation: 'Generation',
    voice: 'Voice',
    learning: 'Learning',
    system: 'System',
  };

  return (
    <span className="text-xs px-1.5 py-0.5 rounded bg-gray-700 text-gray-400">
      {sourceLabels[source]}
    </span>
  );
}

interface ActionButtonProps {
  action: AlertAction;
}

function ActionButton({ action }: ActionButtonProps): React.ReactElement {
  if (action.href) {
    return (
      <a href={action.href} className="text-xs text-blue-400 hover:text-blue-300 transition-colors">
        {action.label} →
      </a>
    );
  }

  return (
    <button
      onClick={action.onClick}
      className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
    >
      {action.label}
    </button>
  );
}

function EmptyAlerts(): React.ReactElement {
  return (
    <div className="text-center py-8">
      <span className="text-2xl text-gray-600" aria-hidden="true">
        ✓
      </span>
      <p className="text-gray-400 mt-2">No alerts</p>
      <p className="text-xs text-gray-500 mt-1">All systems operating normally</p>
    </div>
  );
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}

export function createAlert(
  type: AlertType,
  message: string,
  options?: { title?: string; source?: AlertSource; action?: AlertAction }
): Alert {
  return {
    id: `alert-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    type,
    message,
    timestamp: new Date().toISOString(),
    ...options,
  };
}

export function createBudgetWarningAlert(usedPercent: number, apiName: string): Alert {
  return createAlert('warning', `${apiName} budget at ${usedPercent}% of monthly limit`, {
    title: 'Budget Warning',
    source: 'budget',
    action: { label: 'View Settings', href: '/settings' },
  });
}

export function createBudgetExceededAlert(apiName: string): Alert {
  return createAlert('error', `${apiName} budget exceeded. Operations paused.`, {
    title: 'Budget Exceeded',
    source: 'budget',
    action: { label: 'View Settings', href: '/settings' },
  });
}

export function createScrapingFailureAlert(handle: string, errorCount: number): Alert {
  return createAlert(
    'warning',
    `Failed to scrape @${handle}. ${errorCount} consecutive failures.`,
    { source: 'scraping' }
  );
}

export function createBulkScrapingFailureAlert(failurePercent: number): Alert {
  return createAlert(
    'error',
    `${failurePercent}% of accounts failed during scrape. Check API status.`,
    { title: 'Bulk Scraping Failure', source: 'scraping' }
  );
}

export function createAgentStuckAlert(patternDescription: string, rejectionCount: number): Alert {
  return createAlert(
    'warning',
    `Agent stuck on pattern: "${patternDescription}". ${rejectionCount} rejections.`,
    {
      title: 'Agent Needs Help',
      source: 'learning',
      action: { label: 'Review Patterns', href: '/knowledge' },
    }
  );
}

export function createContentReadyAlert(pendingCount: number): Alert {
  const message = `${pendingCount} post${pendingCount > 1 ? 's' : ''} ready for review`;
  return createAlert('info', message, {
    source: 'generation',
    action: { label: 'Review Queue', href: '/queue' },
  });
}

export function createTimeSensitiveAlert(topic: string): Alert {
  return createAlert('warning', `Time-sensitive opportunity detected: ${topic}`, {
    title: 'Time-Sensitive Content',
    source: 'generation',
    action: { label: 'Review Now', href: '/queue' },
  });
}
