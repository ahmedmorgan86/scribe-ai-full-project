'use client';

export interface QueueSummaryData {
  pendingCount: number;
  draftCount: number;
  approvedTodayCount: number;
}

interface QueueSummaryProps {
  summary: QueueSummaryData;
}

export function QueueSummary({ summary }: QueueSummaryProps): React.ReactElement {
  const total = summary.pendingCount + summary.draftCount;

  if (total === 0) {
    return (
      <div className="text-gray-400 text-center py-8">
        No posts in queue. The agent will generate new content based on your sources.
      </div>
    );
  }

  const pendingPercentage = total > 0 ? (summary.pendingCount / total) * 100 : 0;

  return (
    <div className="space-y-3">
      <QueueSummaryRow label="Pending review" count={summary.pendingCount} />
      <QueueSummaryRow label="In draft" count={summary.draftCount} />

      <div className="h-2 bg-gray-700 rounded-full overflow-hidden mt-4">
        <div
          className="h-full bg-blue-500 rounded-full transition-all duration-300"
          style={{ width: `${pendingPercentage}%` }}
        />
      </div>

      <div className="text-xs text-gray-500 text-center">
        {summary.pendingCount} of {total} ready for review
      </div>
    </div>
  );
}

interface QueueSummaryRowProps {
  label: string;
  count: number;
}

function QueueSummaryRow({ label, count }: QueueSummaryRowProps): React.ReactElement {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-gray-400">{label}</span>
      <span className="text-white font-medium">{count}</span>
    </div>
  );
}
