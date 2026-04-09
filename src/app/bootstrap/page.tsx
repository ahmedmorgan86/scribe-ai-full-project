'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Bootstrap page now redirects to /config
 * The configuration wizard has been replaced with a tabbed configuration page.
 */
export default function BootstrapPage(): React.ReactElement {
  const router = useRouter();

  useEffect(() => {
    router.replace('/config');
  }, [router]);

  return (
    <div className="flex items-center justify-center h-64">
      <div className="text-gray-400">Redirecting to configuration...</div>
    </div>
  );
}
