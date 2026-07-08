import { type NextRequest } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { getProtectionMode } from '@/lib/security-policy';
import { parseSshThreats } from '@/lib/threats';
import { ingestSample } from '@/app/api/traffic/route';
import { getPendingDeviceCount } from '@/lib/devices';

export const dynamic = 'force-dynamic';

const SIDEBAR_INTERVAL_MS  = 20_000;
const STATS_INTERVAL_MS    = 15_000;
const TRAFFIC_INTERVAL_MS  = 15 * 60_000;  // 15 min

let lastTrafficIngest = 0;

function encode(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function GET(req: NextRequest) {
  const auth = requireApiRole(req, 'viewer');
  if ('response' in auth) return auth.response;

  const { signal } = req;

  const stream = new ReadableStream({
    async start(controller) {
      function push(event: string, data: unknown) {
        try { controller.enqueue(encode(event, data)); } catch {}
      }

      async function sendAll() {
        push('security_mode', { mode: getProtectionMode() });
        try {
          const threats = await parseSshThreats();
          push('threat_count', { count: threats.length });
        } catch {
          push('threat_count', { count: 0 });
        }
        push('pending_device_count', { count: getPendingDeviceCount() });
      }

      await sendAll();

      // Ingest traffic on first connection if not done recently
      const now = Date.now();
      if (now - lastTrafficIngest > TRAFFIC_INTERVAL_MS) {
        lastTrafficIngest = now;
        ingestSample().catch(() => {});
      }

      let seq = 0;
      push('stats_tick', { seq: seq++ });

      const sidebarId = setInterval(async () => {
        if (signal.aborted) { clearInterval(sidebarId); return; }
        await sendAll();
      }, SIDEBAR_INTERVAL_MS);

      const statsId = setInterval(() => {
        if (signal.aborted) { clearInterval(statsId); return; }
        push('stats_tick', { seq: seq++ });
      }, STATS_INTERVAL_MS);

      signal.addEventListener('abort', () => {
        clearInterval(sidebarId);
        clearInterval(statsId);
        try { controller.close(); } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
