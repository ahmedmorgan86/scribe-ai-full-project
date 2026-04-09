'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useBootstrapStatus } from '@/hooks/useBootstrapStatus';

interface BootstrapGuardProps {
  children: React.ReactNode;
}

const UNPROTECTED_PATHS = ['/bootstrap', '/api'];

export function BootstrapGuard({ children }: BootstrapGuardProps): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const { status, isLoading } = useBootstrapStatus();

  const isUnprotectedPath = UNPROTECTED_PATHS.some((path) => pathname.startsWith(path));

  useEffect(() => {
    if (isLoading || isUnprotectedPath) return;

    if (status !== null && !status.isReady) {
      router.replace('/bootstrap');
    }
  }, [status, isLoading, router, isUnprotectedPath]);

  if (isUnprotectedPath) {
    return <>{children}</>;
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <div className="text-gray-400">Checking setup status...</div>
      </div>
    );
  }

  if (status !== null && !status.isReady) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <div className="text-gray-400">Redirecting to setup...</div>
      </div>
    );
  }

  return <>{children}</>;
}
