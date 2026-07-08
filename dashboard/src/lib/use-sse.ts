'use client';
import { useEffect, useRef, useState } from 'react';
import { apiUrl } from './api-path';

export interface GlobalSseState {
  securityMode: 'temp-ban' | 'permanent-deny' | null;
  threatCount: number;
  pendingDeviceCount: number;
  statsSeq: number;
}

export function useGlobalSSE(): GlobalSseState {
  const [state, setState] = useState<GlobalSseState>({ securityMode: null, threatCount: 0, pendingDeviceCount: 0, statsSeq: 0 });
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let es: EventSource;
    let dead = false;

    function connect() {
      if (dead) return;
      es = new EventSource(apiUrl('/api/events'));

      es.addEventListener('security_mode', (e: MessageEvent) => {
        try {
          const d = JSON.parse(e.data as string) as { mode: 'temp-ban' | 'permanent-deny' };
          setState(s => ({ ...s, securityMode: d.mode }));
        } catch {}
      });

      es.addEventListener('threat_count', (e: MessageEvent) => {
        try {
          const d = JSON.parse(e.data as string) as { count: number };
          setState(s => ({ ...s, threatCount: d.count }));
        } catch {}
      });

      es.addEventListener('pending_device_count', (e: MessageEvent) => {
        try {
          const d = JSON.parse(e.data as string) as { count: number };
          setState(s => ({ ...s, pendingDeviceCount: d.count }));
        } catch {}
      });

      es.addEventListener('stats_tick', (e: MessageEvent) => {
        try {
          const d = JSON.parse(e.data as string) as { seq: number };
          setState(s => ({ ...s, statsSeq: d.seq }));
        } catch {}
      });

      es.onerror = () => {
        es.close();
        if (!dead) retryRef.current = setTimeout(connect, 5_000);
      };
    }

    connect();

    return () => {
      dead = true;
      if (retryRef.current) clearTimeout(retryRef.current);
      es?.close();
    };
  }, []);

  return state;
}
