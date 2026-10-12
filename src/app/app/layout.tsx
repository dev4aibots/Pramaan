import { isDemoMode } from '@/lib/demo';
import DemoBanner from '@/components/DemoBanner';

// Evaluate demo mode per request, not once at build time:
// a build-time DATABASE_URL (or lack of one) must not freeze the banner state.
export const dynamic = 'force-dynamic';

// Workspace shell layout. Renders the demo banner above the app only when
// the deployment is running in zero-config demo mode (no external DATABASE_URL).
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {isDemoMode() ? <DemoBanner /> : null}
      {children}
    </>
  );
}
