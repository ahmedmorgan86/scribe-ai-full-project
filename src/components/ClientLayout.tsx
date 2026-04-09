'use client';

import { BootstrapGuard } from './BootstrapGuard';
import { ErrorBoundary } from './error';

interface ClientLayoutProps {
  children: React.ReactNode;
}

export function ClientLayout({ children }: ClientLayoutProps): React.ReactElement {
  return (
    <ErrorBoundary>
      <BootstrapGuard>{children}</BootstrapGuard>
    </ErrorBoundary>
  );
}
