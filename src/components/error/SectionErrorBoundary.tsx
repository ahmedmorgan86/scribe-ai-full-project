'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';

interface SectionErrorBoundaryProps {
  children: ReactNode;
  section: 'sidebar' | 'header' | 'content';
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface SectionErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

const SECTION_CONFIG: Record<
  SectionErrorBoundaryProps['section'],
  { title: string; minHeight: string; bg: string }
> = {
  sidebar: {
    title: 'Navigation',
    minHeight: 'min-h-screen',
    bg: 'bg-gray-800',
  },
  header: {
    title: 'Header',
    minHeight: 'min-h-[64px]',
    bg: 'bg-gray-800',
  },
  content: {
    title: 'Content',
    minHeight: 'min-h-[200px]',
    bg: 'bg-gray-900',
  },
};

export class SectionErrorBoundary extends Component<
  SectionErrorBoundaryProps,
  SectionErrorBoundaryState
> {
  constructor(props: SectionErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<SectionErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.props.onError?.(error, errorInfo);
    console.error(`SectionErrorBoundary [${this.props.section}] caught error:`, error, errorInfo);
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    const { hasError, error } = this.state;
    const { children, section } = this.props;
    const config = SECTION_CONFIG[section];

    if (hasError) {
      return (
        <div
          className={`flex items-center justify-center ${config.minHeight} ${config.bg} p-4`}
          role="alert"
        >
          <div className="text-center">
            <div className="mb-2 text-red-400">
              <svg
                className="h-8 w-8 mx-auto"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
                />
              </svg>
            </div>
            <p className="text-sm text-gray-400 mb-2">{config.title} error</p>
            {error && (
              <p className="text-xs text-gray-500 mb-3 max-w-xs truncate">{error.message}</p>
            )}
            <button
              onClick={this.handleRetry}
              className="text-xs text-blue-400 hover:text-blue-300"
            >
              Try again
            </button>
          </div>
        </div>
      );
    }

    return children;
  }
}

export default SectionErrorBoundary;
