'use client';

import { useState, useEffect, useCallback } from 'react';
import type {
  JobInfo,
  DebugTraceEntry,
  CheckpointInfo,
  HealthResponse,
} from '@/lib/generation/langgraph-client';

interface JobListResponse {
  jobs: JobInfo[];
  total: number;
}

interface DebugTraceResponse {
  job_id: string;
  found: boolean;
  job_info: JobInfo | null;
  checkpoints: CheckpointInfo[] | null;
  trace: DebugTraceEntry[] | null;
}

const NODE_COLORS: Record<string, string> = {
  analyze_source: 'bg-blue-500',
  select_formula: 'bg-purple-500',
  generate_draft: 'bg-indigo-500',
  voice_check: 'bg-cyan-500',
  slop_check: 'bg-teal-500',
  stylometric_check: 'bg-emerald-500',
  critique: 'bg-yellow-500',
  rewrite: 'bg-orange-500',
  finalize: 'bg-green-500',
  reject: 'bg-red-500',
};

function getNodeColor(node: string): string {
  return NODE_COLORS[node] ?? 'bg-gray-500';
}

function getStatusBadge(status: string | null): React.ReactElement {
  if (!status) {
    return <span className="px-2 py-0.5 text-xs rounded bg-gray-700 text-gray-300">Unknown</span>;
  }

  if (status === 'completed' || status === 'success') {
    return <span className="px-2 py-0.5 text-xs rounded bg-green-900 text-green-300">Success</span>;
  }
  if (status === 'running') {
    return (
      <span className="px-2 py-0.5 text-xs rounded bg-blue-900 text-blue-300 animate-pulse">
        Running
      </span>
    );
  }
  if (status === 'rejected' || status === 'error') {
    return <span className="px-2 py-0.5 text-xs rounded bg-red-900 text-red-300">Failed</span>;
  }
  return <span className="px-2 py-0.5 text-xs rounded bg-gray-700 text-gray-300">{status}</span>;
}

function formatDuration(ms: number | undefined): string {
  if (ms === undefined || ms === 0) return '-';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function formatTimestamp(ts: string | null): string {
  if (!ts) return '-';
  return new Date(ts).toLocaleString();
}

interface TraceNodeProps {
  entry: DebugTraceEntry;
  isLast: boolean;
}

function TraceNode({ entry, isLast }: TraceNodeProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="relative">
      {!isLast && (
        <div className="absolute left-4 top-10 w-0.5 h-full bg-gray-700" aria-hidden="true" />
      )}
      <div className="flex items-start gap-3">
        <div
          className={`w-8 h-8 rounded-full ${getNodeColor(entry.node)} flex items-center justify-center flex-shrink-0 relative z-10`}
        >
          <span className="text-xs font-bold text-white">{entry.node.charAt(0).toUpperCase()}</span>
        </div>
        <div className="flex-1 min-w-0 pb-6">
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-full text-left p-3 rounded-lg bg-gray-800 border border-gray-700 hover:border-gray-600 transition-colors"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium text-white">{entry.node}</span>
              <div className="flex items-center gap-2">
                {entry.duration_ms !== undefined && entry.duration_ms > 0 && (
                  <span className="text-xs text-gray-500">{formatDuration(entry.duration_ms)}</span>
                )}
                <svg
                  className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </div>
            </div>
            {entry.message && <p className="text-xs text-gray-400 truncate">{entry.message}</p>}
          </button>

          {expanded && entry.state && (
            <div className="mt-2 p-3 rounded-lg bg-gray-900 border border-gray-700">
              <h4 className="text-xs font-medium text-gray-400 mb-2">State Snapshot</h4>
              <pre className="text-xs text-gray-300 overflow-x-auto whitespace-pre-wrap max-h-64 overflow-y-auto">
                {JSON.stringify(entry.state, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface CheckpointListProps {
  checkpoints: CheckpointInfo[];
  onSelect: (checkpoint: CheckpointInfo) => void;
  selected: string | null;
}

function CheckpointList({
  checkpoints,
  onSelect,
  selected,
}: CheckpointListProps): React.ReactElement {
  return (
    <div className="space-y-2">
      {checkpoints.map((cp) => (
        <button
          key={cp.checkpoint_id}
          onClick={() => onSelect(cp)}
          className={`w-full text-left p-3 rounded-lg border transition-colors ${
            selected === cp.checkpoint_id
              ? 'bg-blue-900/30 border-blue-500'
              : 'bg-gray-800 border-gray-700 hover:border-gray-600'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-mono text-gray-300 truncate max-w-[200px]">
              {cp.checkpoint_id.substring(0, 12)}...
            </span>
            <span className="text-xs text-gray-500">{formatTimestamp(cp.created_at)}</span>
          </div>
        </button>
      ))}
    </div>
  );
}

interface JobCardProps {
  job: JobInfo;
  isSelected: boolean;
  onSelect: () => void;
}

function JobCard({ job, isSelected, onSelect }: JobCardProps): React.ReactElement {
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left p-4 rounded-lg border transition-colors ${
        isSelected
          ? 'bg-blue-900/30 border-blue-500'
          : 'bg-gray-800 border-gray-700 hover:border-gray-600'
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-mono text-gray-300 truncate max-w-[180px]" title={job.job_id}>
          {job.job_id.substring(0, 16)}...
        </span>
        {getStatusBadge(job.final_status ?? job.status)}
      </div>
      <div className="flex items-center gap-4 text-xs text-gray-500">
        <span>{job.content_type}</span>
        <span>
          {job.source_count} source{job.source_count !== 1 ? 's' : ''}
        </span>
      </div>
      <div className="text-xs text-gray-500 mt-1">{formatTimestamp(job.started_at)}</div>
      {job.error && <p className="text-xs text-red-400 mt-2 truncate">{job.error}</p>}
    </button>
  );
}

export default function GenerationDebugPage(): React.ReactElement {
  const [jobs, setJobs] = useState<JobInfo[]>([]);
  const [selectedJob, setSelectedJob] = useState<JobInfo | null>(null);
  const [trace, setTrace] = useState<DebugTraceEntry[] | null>(null);
  const [checkpoints, setCheckpoints] = useState<CheckpointInfo[] | null>(null);
  const [selectedCheckpoint, setSelectedCheckpoint] = useState<CheckpointInfo | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingTrace, setIsLoadingTrace] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch('/api/langgraph/health');
      if (response.ok) {
        const data = (await response.json()) as HealthResponse;
        setHealth(data);
      }
    } catch {
      // Silent fail - health is informational
    }
  }, []);

  const fetchJobs = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/langgraph/jobs?limit=50');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = (await response.json()) as JobListResponse;
      setJobs(data.jobs ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch jobs');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchJobTrace = useCallback(async (jobId: string): Promise<void> => {
    setIsLoadingTrace(true);
    setTrace(null);
    setCheckpoints(null);
    setSelectedCheckpoint(null);
    try {
      const response = await fetch(`/api/langgraph/debug/${encodeURIComponent(jobId)}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = (await response.json()) as DebugTraceResponse;
      if (data.found) {
        setTrace(data.trace);
        setCheckpoints(data.checkpoints);
        if (data.job_info) {
          setSelectedJob(data.job_info);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch trace');
    } finally {
      setIsLoadingTrace(false);
    }
  }, []);

  useEffect(() => {
    void fetchHealth();
    void fetchJobs();
  }, [fetchHealth, fetchJobs]);

  const handleSelectJob = (job: JobInfo): void => {
    setSelectedJob(job);
    void fetchJobTrace(job.job_id);
  };

  const handleSelectCheckpoint = (checkpoint: CheckpointInfo): void => {
    setSelectedCheckpoint(checkpoint);
  };

  const workerAvailable = health?.status !== 'unavailable';

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Generation Debug</h1>
          <p className="text-sm text-gray-400 mt-1">
            Visualize LangGraph pipeline execution and inspect checkpoints
          </p>
        </div>
        <div className="flex items-center gap-4">
          {health && (
            <div className="flex items-center gap-2">
              <div
                className={`w-2 h-2 rounded-full ${
                  health.status === 'healthy'
                    ? 'bg-green-500'
                    : health.status === 'degraded'
                      ? 'bg-yellow-500'
                      : 'bg-red-500'
                }`}
              />
              <span className="text-xs text-gray-400">
                {health.status === 'healthy'
                  ? 'Worker Online'
                  : health.status === 'degraded'
                    ? 'Worker Degraded'
                    : 'Worker Offline'}
              </span>
            </div>
          )}
          <button
            onClick={() => void fetchJobs()}
            disabled={isLoading}
            className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-600 text-gray-200 hover:bg-gray-700 disabled:opacity-50"
          >
            {isLoading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-900/20 border border-red-500/50 p-4">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {!workerAvailable && (
        <div className="rounded-lg bg-yellow-900/20 border border-yellow-500/50 p-4">
          <p className="text-sm text-yellow-400">
            LangGraph worker is not available. Start the Python worker to view generation traces.
          </p>
          <pre className="mt-2 text-xs text-gray-400 bg-gray-900 p-2 rounded">
            cd src/workers/langgraph && python server.py
          </pre>
        </div>
      )}

      <div className="grid grid-cols-12 gap-6">
        {/* Job List */}
        <div className="col-span-3">
          <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
            <h2 className="text-sm font-medium text-white mb-4">Recent Jobs</h2>
            {isLoading ? (
              <div className="text-sm text-gray-400 text-center py-8">Loading jobs...</div>
            ) : jobs.length === 0 ? (
              <div className="text-sm text-gray-500 text-center py-8">No generation jobs yet</div>
            ) : (
              <div className="space-y-2 max-h-[600px] overflow-y-auto">
                {jobs.map((job) => (
                  <JobCard
                    key={job.job_id}
                    job={job}
                    isSelected={selectedJob?.job_id === job.job_id}
                    onSelect={() => handleSelectJob(job)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Trace View */}
        <div className="col-span-6">
          <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
            <h2 className="text-sm font-medium text-white mb-4">Execution Trace</h2>
            {!selectedJob ? (
              <div className="text-sm text-gray-500 text-center py-12">
                Select a job to view its execution trace
              </div>
            ) : isLoadingTrace ? (
              <div className="text-sm text-gray-400 text-center py-12">Loading trace...</div>
            ) : !trace || trace.length === 0 ? (
              <div className="text-sm text-gray-500 text-center py-12">
                No trace data available for this job.
                <br />
                <span className="text-xs text-gray-600">
                  Ensure debug=true was set during generation.
                </span>
              </div>
            ) : (
              <div className="space-y-0">
                {trace.map((entry, idx) => (
                  <TraceNode
                    key={`${entry.node}-${entry.timestamp ?? idx}`}
                    entry={entry}
                    isLast={idx === trace.length - 1}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Job Summary */}
          {selectedJob && (
            <div className="mt-4 rounded-lg border border-gray-700 bg-gray-800 p-4">
              <h3 className="text-sm font-medium text-white mb-3">Job Details</h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-500">Job ID:</span>
                  <p className="text-gray-300 font-mono text-xs break-all">{selectedJob.job_id}</p>
                </div>
                <div>
                  <span className="text-gray-500">Thread ID:</span>
                  <p className="text-gray-300 font-mono text-xs break-all">
                    {selectedJob.thread_id}
                  </p>
                </div>
                <div>
                  <span className="text-gray-500">Content Type:</span>
                  <p className="text-gray-300">{selectedJob.content_type}</p>
                </div>
                <div>
                  <span className="text-gray-500">Sources:</span>
                  <p className="text-gray-300">{selectedJob.source_count}</p>
                </div>
                <div>
                  <span className="text-gray-500">Started:</span>
                  <p className="text-gray-300">{formatTimestamp(selectedJob.started_at)}</p>
                </div>
                <div>
                  <span className="text-gray-500">Completed:</span>
                  <p className="text-gray-300">{formatTimestamp(selectedJob.completed_at)}</p>
                </div>
                {selectedJob.error && (
                  <div className="col-span-2">
                    <span className="text-gray-500">Error:</span>
                    <p className="text-red-400 text-xs mt-1">{selectedJob.error}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Checkpoints */}
        <div className="col-span-3">
          <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
            <h2 className="text-sm font-medium text-white mb-4">Checkpoints</h2>
            {!selectedJob ? (
              <div className="text-sm text-gray-500 text-center py-8">
                Select a job to view checkpoints
              </div>
            ) : !checkpoints || checkpoints.length === 0 ? (
              <div className="text-sm text-gray-500 text-center py-8">No checkpoints available</div>
            ) : (
              <CheckpointList
                checkpoints={checkpoints}
                onSelect={handleSelectCheckpoint}
                selected={selectedCheckpoint?.checkpoint_id ?? null}
              />
            )}
          </div>

          {/* Checkpoint Detail */}
          {selectedCheckpoint && (
            <div className="mt-4 rounded-lg border border-gray-700 bg-gray-800 p-4">
              <h3 className="text-sm font-medium text-white mb-3">Checkpoint State</h3>
              <div className="text-xs text-gray-500 mb-2">
                ID: {selectedCheckpoint.checkpoint_id.substring(0, 20)}...
              </div>
              <pre className="text-xs text-gray-300 bg-gray-900 p-3 rounded overflow-x-auto max-h-80 overflow-y-auto whitespace-pre-wrap">
                {JSON.stringify(selectedCheckpoint.state, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>

      {/* Graph Legend */}
      <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
        <h2 className="text-sm font-medium text-white mb-3">Pipeline Nodes</h2>
        <div className="flex flex-wrap gap-3">
          {Object.entries(NODE_COLORS).map(([node, color]) => (
            <div key={node} className="flex items-center gap-2">
              <div className={`w-4 h-4 rounded-full ${color}`} />
              <span className="text-xs text-gray-400">{node.replace(/_/g, ' ')}</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-3">
          The pipeline flows: analyze source → select formula → generate draft → voice check → slop
          check → stylometric check → finalize. Failed checks route to critique → rewrite (max 3
          cycles).
        </p>
      </div>
    </div>
  );
}
