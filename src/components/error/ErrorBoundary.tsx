'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });
    this.props.onError?.(error, errorInfo);
    console.error('ErrorBoundary caught error:', error, errorInfo);
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback !== undefined) {
        return this.props.fallback;
      }

      return (
        <DefaultErrorFallback
          error={this.state.error}
          errorInfo={this.state.errorInfo}
          onRetry={this.handleRetry}
        />
      );
    }

    return this.props.children;
  }
}

interface DefaultErrorFallbackProps {
  error: Error | null;
  errorInfo: ErrorInfo | null;
  onRetry: () => void;
}

function DefaultErrorFallback({
  error,
  errorInfo,
  onRetry,
}: DefaultErrorFallbackProps): React.ReactElement {
  const [showDetails, setShowDetails] = React.useState(false);

  return (
    <div className="flex min-h-[400px] flex-col items-center justify-center rounded-lg border border-red-800 bg-red-900/20 p-8">
      <div className="mb-4 text-red-400">
        <svg
          className="h-16 w-16"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
          />
        </svg>
      </div>

      <h2 className="mb-2 text-xl font-semibold text-gray-100">Something went wrong</h2>
      <p className="mb-6 max-w-md text-center text-gray-400">
        An unexpected error occurred. You can try again or refresh the page.
      </p>

      <div className="flex gap-4">
        <button
          onClick={onRetry}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-900"
        >
          Try Again
        </button>
        <button
          onClick={() => window.location.reload()}
          className="rounded-md border border-gray-600 bg-gray-800 px-4 py-2 text-sm font-medium text-gray-300 hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 focus:ring-offset-gray-900"
        >
          Refresh Page
        </button>
      </div>

      {error && (
        <div className="mt-6 w-full max-w-2xl">
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="text-sm text-gray-500 hover:text-gray-400"
          >
            {showDetails ? 'Hide' : 'Show'} error details
          </button>

          {showDetails && (
            <div className="mt-2 overflow-auto rounded-md bg-gray-800/50 p-4">
              <p className="mb-2 font-mono text-sm text-red-400">{error.message}</p>
              {errorInfo?.componentStack && (
                <pre className="whitespace-pre-wrap font-mono text-xs text-gray-500">
                  {errorInfo.componentStack}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default ErrorBoundary;
