import { Suspense } from 'react';
import SettingsPageClient from './SettingsPageClient';

export const dynamic = 'force-dynamic';

export default function SettingsPage() {
  return (
    <Suspense fallback={<div style={{ padding: 32, color: 'rgba(180,195,215,0.4)', fontSize: 13 }}>Loading…</div>}>
      <SettingsPageClient />
    </Suspense>
  );
}
