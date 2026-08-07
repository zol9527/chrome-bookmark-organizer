import { useCallback, useState } from 'react';
import type { InternalRequest, InternalResponseData } from '../../shared/messaging';
import { rpc } from '../../shared/rpc-client';

export function useRpc() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const call = useCallback(
    async <T extends InternalRequest['type']>(request: Extract<InternalRequest, { type: T }>) => {
      setLoading(true);
      setError(null);
      try {
        return await rpc.call(request) as InternalResponseData[T];
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : 'Something went wrong';
        setError(message);
        throw reason;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { rpc, call, loading, error, clearError: () => setError(null) };
}
