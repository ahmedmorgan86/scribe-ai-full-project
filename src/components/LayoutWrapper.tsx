'use client';

import { Sidebar } from '@/components/navigation';
import { Header } from '@/components/header';
import { ClientLayout } from '@/components/ClientLayout';
import { SectionErrorBoundary } from '@/components/error';

interface LayoutWrapperProps {
  children: React.ReactNode;
}

export function LayoutWrapper({ children }: LayoutWrapperProps): React.ReactElement {
  return (
    <div className="flex h-screen overflow-hidden">
      <SectionErrorBoundary section="sidebar">
        <Sidebar />
      </SectionErrorBoundary>

      <div className="flex flex-1 flex-col overflow-hidden">
        <SectionErrorBoundary section="header">
          <Header />
        </SectionErrorBoundary>

        <main className="flex-1 overflow-y-auto p-6">
          <ClientLayout>{children}</ClientLayout>
        </main>
      </div>
    </div>
  );
}
