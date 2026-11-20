import type { Connection } from './connection';

type Reader = (session: Connection, id: string, signal: AbortSignal) => Promise<string | null>;
type Subscriber = (uri: string | null) => void;
type Request = { id: string; controller: AbortController; subscribers: Set<Subscriber>; started: boolean };
type Entry = { uri: string | null; expires: number };

// Covers can contain up to 2 MiB of image data. Limit both retained bytes and
// concurrent transfers on TVs, where a fast remote scroll can cross many cards.
export function createCoverCache(session: Connection, read: Reader) {
  const cache = new Map<string, Entry>();
  const pending = new Map<string, Request>();
  let bytes = 0;
  let active = 0;

  function remove(id: string) {
    bytes -= cache.get(id)?.uri?.length ?? 0;
    cache.delete(id);
  }

  function remember(id: string, uri: string | null) {
    remove(id);
    cache.set(id, { uri, expires: Date.now() + (uri ? 30 * 60_000 : 60_000) });
    bytes += uri?.length ?? 0;
    for (const key of cache.keys()) {
      if (cache.size <= 32 && bytes <= 8 * 1024 * 1024) break;
      remove(key);
    }
  }

  function dispatch() {
    for (const request of pending.values()) {
      if (active >= 3) break;
      if (request.started) continue;
      active++;
      request.started = true;
      const timeout = setTimeout(() => request.controller.abort(), 15_000);
      void read(session, request.id, request.controller.signal)
        .catch(() => null)
        .then((uri) => {
          if (pending.get(request.id) !== request) return;
          remember(request.id, uri);
          for (const subscriber of request.subscribers) subscriber(uri);
        })
        .finally(() => {
          clearTimeout(timeout);
          if (pending.get(request.id) === request) pending.delete(request.id);
          active--;
          dispatch();
        });
    }
  }

  return {
    subscribe(id: string, subscriber: Subscriber) {
      const hit = cache.get(id);
      if (hit) {
        remove(id);
        if (hit.expires > Date.now()) {
          cache.set(id, hit);
          bytes += hit.uri?.length ?? 0;
          subscriber(hit.uri);
          return () => {};
        }
      }
      const request: Request = pending.get(id) ?? {
        id,
        controller: new AbortController(),
        subscribers: new Set(),
        started: false,
      };
      request.subscribers.add(subscriber);
      pending.set(id, request);
      dispatch();
      return () => {
        request.subscribers.delete(subscriber);
        if (!request.subscribers.size && pending.get(id) === request) {
          pending.delete(id);
          request.controller.abort();
        }
      };
    },
  };
}
