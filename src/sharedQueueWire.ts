import type { QueueEdit, QueueSnapshot } from './audio';
import type { Track } from './playlistStreams';

type Fields = Record<string, unknown>;
function identifier(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 256) throw new Error('Invalid queue identifier.');
  return value;
}
function integer(value: unknown, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max)
    throw new Error('Invalid queue position.');
  return value;
}

export function queueEdit(raw: Fields, decodeTrack: (value: unknown) => Track): QueueEdit {
  const sessionId = identifier(raw.sessionId);
  switch (raw.action) {
    case 'move':
      return {sessionId, action: 'move', entryId: identifier(raw.entryId),
        beforeEntryId: raw.beforeEntryId === null ? null : identifier(raw.beforeEntryId)};
    case 'remove': case 'pin': case 'jump':
      return {sessionId, action: raw.action, entryId: identifier(raw.entryId)};
    case 'seek':
      return {sessionId, action: 'seek', entryId: identifier(raw.entryId), positionMs: integer(raw.positionMs, 86_400_000)};
    case 'handoffPause':
      return {sessionId, action: 'handoffPause', entryId: identifier(raw.entryId), revision: integer(raw.revision, Number.MAX_SAFE_INTEGER)};
    case 'shuffle':
      if (typeof raw.enabled !== 'boolean') throw new Error('Invalid shuffle option.');
      return {sessionId, action: 'shuffle', enabled: raw.enabled};
    case 'flow':
      return {sessionId, action: 'flow', flowId: raw.flowId === null ? null : identifier(raw.flowId)};
    case 'enqueue':
      if (!Array.isArray(raw.tracks) || !raw.tracks.length || raw.tracks.length > 100 ||
        (raw.placement !== 'next' && raw.placement !== 'end')) throw new Error('Invalid queue items.');
      return {sessionId, action: 'enqueue', placement: raw.placement, tracks: raw.tracks.map(decodeTrack)};
    case 'pause': case 'resume': case 'next': case 'previous':
      return {sessionId, action: raw.action};
    default: throw new Error('Unknown queue command.');
  }
}

export async function snapshotPage(raw: Fields, read: (offset: number, limit: number) => Promise<QueueSnapshot>) {
  const offset = integer(raw.offset ?? 0, 2_147_483_647);
  const check = offset === 0 && typeof raw.knownRevision === 'number';
  let state = await read(offset, check ? 0 : 48);
  const unchanged = check && state.revision === raw.knownRevision && state.sessionId === raw.knownSessionId;
  if (check && !unchanged) state = await read(0, 48);
  if (offset > 0 && (raw.revision !== state.revision || raw.sessionId !== state.sessionId)) {
    throw new Error('The TV queue changed during sync.');
  }
  const {sessionId,revision,currentEntryId,index,total,positionMs,durationMs,playing,buffering,canSeek,
    shuffle,flowId,flowName,collectionId} = state;
  // Reserve room for the outer envelope, nonce and base64 expansion. Larger libraries
  // use multiple coherent pages instead of truncating the visible queue.
  let remaining = 90_000;
  const encoder = new TextEncoder();
  const entries = [];
  for (const track of state.entries) {
    const size = encoder.encode(JSON.stringify(track)).length + 1;
    if (size > remaining) break;
    entries.push(track);
    remaining -= size;
  }
  if (!unchanged && offset < total && !entries.length) throw new Error('Invalid queue metadata.');
  return {sessionId,revision,currentEntryId,index,total,positionMs,durationMs,playing,buffering,canSeek,
    shuffle,flowId,flowName,collectionId,entries,offset,unchanged};
}
