import { Suspense } from 'react';
import VpnUsersPageClient from './VpnUsersPageClient';

export const dynamic = 'force-dynamic';

export default function VpnUsersPage() {
  return (
    <Suspense fallback={<div style={{ padding: 32, color: 'rgba(180,195,215,0.4)', fontSize: 13 }}>Loading…</div>}>
      <VpnUsersPageClient />
    </Suspense>
  );
}
