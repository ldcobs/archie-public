import { protocolStatus, listGroups } from '@/lib/inbounds';
import { getManagedInbounds } from '@/lib/inbound-config';

export const dynamic = 'force-dynamic';

// ── Inbounds page (read-only + Tier 2 action surface) ─────────────────────────
// Shows the full 10-protocol catalog as cards (live status + client count),
// plus an integrated key generator.
// Read-only against config.json; the key generator reuses the existing
// /api/users endpoint (the same one the dashboard header button uses).

import ProtocolCatalogClient from './ProtocolCatalogClient';

export default function InboundsPage() {
  const { status, configReadable } = protocolStatus();
  const groups = listGroups();
  const { inbounds, configPath, writable } = getManagedInbounds();

  return (
    <ProtocolCatalogClient
      status={status}
      groups={groups}
      configReadable={configReadable}
      initialInbounds={inbounds}
      configPath={configPath}
      configWritable={writable}
    />
  );
}
