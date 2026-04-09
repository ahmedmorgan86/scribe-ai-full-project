'use client';

export type AgentStatusType = 'idle' | 'generating' | 'processing' | 'error';

export interface AgentActivity {
  status: AgentStatusType;
  currentTask: string | null;
  lastActivity: string | null;
  progress?: number;
  subTasks?: string[];
}

interface AgentStatusProps {
  activity: AgentActivity;
}

const STATUS_CONFIG: Record<
  AgentStatusType,
  { color: string; bgColor: string; label: string; icon: string }
> = {
  idle: { color: 'text-green-400', bgColor: 'bg-green-500', label: 'Idle', icon: '●' },
  generating: {
    color: 'text-blue-400',
    bgColor: 'bg-blue-500',
    label: 'Generating Content',
    icon: '◉',
  },
  processing: {
    color: 'text-yellow-400',
    bgColor: 'bg-yellow-500',
    label: 'Processing Feedback',
    icon: '◎',
  },
  error: { color: 'text-red-400', bgColor: 'bg-red-500', label: 'Error', icon: '✕' },
};

export function AgentStatus({ activity }: AgentStatusProps): React.ReactElement {
  const config = STATUS_CONFIG[activity.status];
  const isActive = activity.status === 'generating' || activity.status === 'processing';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <StatusIndicator status={activity.status} />
          <div>
            <span className={`font-medium ${config.color}`}>{config.label}</span>
            {activity.currentTask && (
              <p className="text-sm text-gray-400 mt-0.5">{activity.currentTask}</p>
            )}
          </div>
        </div>
        {activity.lastActivity && (
          <div className="text-xs text-gray-500">Last active: {activity.lastActivity}</div>
        )}
      </div>

      {isActive && activity.progress !== undefined && <ProgressBar progress={activity.progress} />}

      {isActive && activity.subTasks && activity.subTasks.length > 0 && (
        <SubTaskList tasks={activity.subTasks} />
      )}

      {activity.status === 'idle' && <IdleState />}
    </div>
  );
}

interface StatusIndicatorProps {
  status: AgentStatusType;
}

function StatusIndicator({ status }: StatusIndicatorProps): React.ReactElement {
  const config = STATUS_CONFIG[status];
  const isAnimated = status === 'generating' || status === 'processing';

  return (
    <span className="relative flex h-3 w-3">
      {isAnimated && (
        <span
          className={`absolute inline-flex h-full w-full animate-ping rounded-full ${config.bgColor} opacity-75`}
        />
      )}
      <span className={`relative inline-flex h-3 w-3 rounded-full ${config.bgColor}`} />
    </span>
  );
}

interface ProgressBarProps {
  progress: number;
}

function ProgressBar({ progress }: ProgressBarProps): React.ReactElement {
  const clampedProgress = Math.min(100, Math.max(0, progress));

  return (
    <div className="space-y-1">
      <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
        <div
          className="h-full bg-blue-500 rounded-full transition-all duration-300"
          style={{ width: `${clampedProgress}%` }}
        />
      </div>
      <div className="text-xs text-gray-500 text-right">{clampedProgress}%</div>
    </div>
  );
}

interface SubTaskListProps {
  tasks: string[];
}

function SubTaskList({ tasks }: SubTaskListProps): React.ReactElement {
  return (
    <div className="space-y-1 pl-6 border-l border-gray-700">
      {tasks.map((task, index) => (
        <div key={index} className="text-xs text-gray-500 flex items-center space-x-2">
          <span className="text-gray-600">→</span>
          <span>{task}</span>
        </div>
      ))}
    </div>
  );
}

function IdleState(): React.ReactElement {
  return (
    <div className="text-sm text-gray-500 bg-gray-700/30 rounded-lg p-3">
      Agent is ready. Waiting for new sources or scheduled generation.
    </div>
  );
}

export function formatLastActivity(date: Date | string | null): string | null {
  if (date === null) return null;

  const d = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}
