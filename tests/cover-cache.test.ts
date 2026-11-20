import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCoverCache } from '../src/coverCache.ts';

const session = { serverUrl: 'https://music.example', token: 'test', customHeaders: {} };
const settled = () => new Promise<void>((resolve) => setImmediate(resolve));

test('shelves share an artwork request and cache the completed cover', async () => {
  let reads = 0;
  const cache = createCoverCache(session, async () => {
    reads++;
    return 'cover';
  });
  const seen: (string | null)[] = [];
  const release = cache.subscribe('shared', (uri) => seen.push(uri));
  cache.subscribe('shared', (uri) => seen.push(uri));
  release();
  await settled();
  cache.subscribe('shared', (uri) => seen.push(uri));
  assert.equal(reads, 1);
  assert.deepEqual(seen, ['cover', 'cover']);
});

test('only three covers load at once and offscreen queued work is dropped', async () => {
  const requests = new Map<string, AbortSignal>();
  const cache = createCoverCache(session, async (_session, id, signal) => {
    requests.set(id, signal);
    return new Promise((resolve) => signal.addEventListener('abort', () => resolve(null), { once: true }));
  });
  const releases = ['a', 'b', 'c', 'd', 'e'].map((id) => cache.subscribe(id, () => {}));
  assert.deepEqual([...requests.keys()], ['a', 'b', 'c']);
  releases[3]();
  releases[0]();
  await settled();
  assert.equal(requests.get('a')?.aborted, true);
  assert.deepEqual([...requests.keys()], ['a', 'b', 'c', 'e']);
  releases.forEach((release) => release());
  await settled();
});

test('missing covers are cached and successful entries are evicted by size', async () => {
  const reads = new Map<string, number>();
  const cache = createCoverCache(session, async (_session, id) => {
    reads.set(id, (reads.get(id) || 0) + 1);
    return id === 'missing' ? null : 'x'.repeat(3 * 1024 * 1024);
  });
  for (const id of ['missing', 'missing', 'a', 'b', 'c', 'a']) {
    await new Promise((resolve) => cache.subscribe(id, resolve));
  }
  assert.equal(reads.get('missing'), 1);
  assert.equal(reads.get('a'), 2);
});
