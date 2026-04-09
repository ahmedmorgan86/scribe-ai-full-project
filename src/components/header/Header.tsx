'use client';

import { usePathname } from 'next/navigation';

export type AgentStatus = 'idle' | 'generating' | 'processing' | 'error';

interface AgentStatusInfo {
  status: AgentStatus;
  message?: string;
}

interface HeaderProps {
  agentStatus?: AgentStatusInfo;
}

const PAGE_TITLES: Record<string, string> = {
  '/': 'Home',
  '/queue': 'Queue',
  '/knowledge': 'Knowledge Base',
  '/settings': 'Settings',
  '/training': 'Training Mode',
  '/bootstrap': 'Bootstrap',
};

const STATUS_CONFIG: Record<AgentStatus, { color: string; label: string; pulse: boolean }> = {
  idle: { color: 'bg-green-500', label: 'Agent Idle', pulse: false },
  generating: { color: 'bg-blue-500', label: 'Generating', pulse: true },
  processing: { color: 'bg-yellow-500', label: 'Processing', pulse: true },
  error: { color: 'bg-red-500', label: 'Error', pulse: false },
};

export function Header({ agentStatus }: HeaderProps): React.ReactElement {
  const pathname = usePathname();
  const pageTitle = PAGE_TITLES[pathname] ?? 'Dashboard';

  const status = agentStatus?.status ?? 'idle';
  const statusConfig = STATUS_CONFIG[status];
  const displayMessage = agentStatus?.message ?? statusConfig.label;

  return (
    <header className="flex h-16 items-center justify-between border-b border-gray-700 bg-gray-800 px-6">
      <div className="flex items-center space-x-4">
        <h2 className="text-lg font-medium text-white">{pageTitle}</h2>
      </div>
      <div className="flex items-center space-x-4">
        <AgentStatusIndicator
          color={statusConfig.color}
          label={displayMessage}
          pulse={statusConfig.pulse}
        />
      </div>
    </header>
  );
}

interface AgentStatusIndicatorProps {
  color: string;
  label: string;
  pulse: boolean;
}

function AgentStatusIndicator({
  color,
  label,
  pulse,
}: AgentStatusIndicatorProps): React.ReactElement {
  return (
    <div className="flex items-center space-x-2">
      <span className="relative flex h-2.5 w-2.5">
        {pulse && (
          <span
            className={`absolute inline-flex h-full w-full animate-ping rounded-full ${color} opacity-75`}
          />
        )}
        <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${color}`} />
      </span>
      <span className="text-sm text-gray-400">{label}</span>
    </div>
  );
}
