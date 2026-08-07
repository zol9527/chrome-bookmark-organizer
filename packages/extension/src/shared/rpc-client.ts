import type {
  InternalEvent,
  InternalRequest,
  InternalResponse,
  InternalResponseData,
  RpcCall,
} from './messaging';

export class RpcClient {
  constructor(private readonly timeoutMs = 5_000) {}

  call: RpcCall = <T extends InternalRequest['type']>(
    request: Extract<InternalRequest, { type: T }>,
  ): Promise<InternalResponseData[T]> =>
    new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        callback();
      };
      const timeout = window.setTimeout(() => {
        finish(() => reject(new Error(`Request timed out: ${request.type}`)));
      }, this.timeoutMs);

      try {
        chrome.runtime.sendMessage(request, (rawResponse: unknown) => {
          const runtimeError = chrome.runtime.lastError;
          if (runtimeError) {
            finish(() => reject(new Error(runtimeError.message ?? 'Extension service worker did not respond')));
            return;
          }

          const response = rawResponse as InternalResponse<T> | undefined;
          if (!response) {
            finish(() => reject(new Error(`No response received for ${request.type}`)));
            return;
          }
          if (!response.ok) {
            finish(() => reject(new Error(response.error)));
            return;
          }
          finish(() => resolve(response.data));
        });
      } catch (error) {
        finish(() => reject(error instanceof Error ? error : new Error('Unable to send extension request')));
      }
    });
}

export const rpc = new RpcClient();

function isInternalEvent(message: unknown): message is InternalEvent {
  if (!message || typeof message !== 'object' || !('type' in message)) return false;
  return ['plan:created', 'plan:updated', 'plan:executing', 'plan:completed', 'nm:status'].includes(
    String(message.type),
  );
}

export function subscribeInternalEvent(handler: (event: InternalEvent) => void): () => void {
  const listener = (message: unknown) => {
    if (isInternalEvent(message)) handler(message);
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}
