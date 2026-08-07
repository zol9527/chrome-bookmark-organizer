import { useEffect, useState } from 'react';
import { rpc, subscribeInternalEvent } from '../../shared/rpc-client';

export interface NmStatus {
  connected: boolean;
  hostVersion?: string;
  lastError?: string;
}

export function useNmStatus() {
  const [status, setStatus] = useState<NmStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void rpc
      .call({ type: 'nm:status' })
      .then((next) => active && setStatus(next))
      .catch((error: unknown) =>
        active && setStatus({ connected: false, lastError: error instanceof Error ? error.message : undefined }),
      )
      .finally(() => active && setLoading(false));

    return subscribeInternalEvent((event) => {
      if (event.type === 'nm:status') setStatus(event);
    });
  }, []);

  return { status, loading, setStatus };
}
