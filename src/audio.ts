import { requireNativeModule } from 'expo';
import { collections, tracks, type Track } from './api';
import { audioStreamPath, serverResource, type Connection } from './connection';

export type QueueEntry = Track & { entryId: string; pinned: boolean };
type QueueMetadata = {
  sessionId: string | null; revision: number; currentEntryId: string | null; shuffle: boolean;
  flowId: string | null; flowName: string | null; index: number; total: number;
};
export type Playback = QueueMetadata & {
  id: string | null; title: string | null; artist: string | null; collectionId: string | null;
  albumName: string | null; artworkPath: string | null; streamPath: string | null;
  playing: boolean; buffering: boolean; previous: boolean; next: boolean; message: string | null;
  upNext: { entryId: string; id: string; title: string; artist: string; albumName: string | null; artworkPath: string | null }[];
  positionMs: number; durationMs: number | null; canSeek: boolean;
};
export type QueueSnapshot = Playback & {entries: QueueEntry[]; offset: number};
export type QueueEdit = {sessionId: string} & (
  | {action: 'move'; entryId: string; beforeEntryId: string | null}
  | {action: 'pin' | 'jump' | 'remove'; entryId: string}
  | {action: 'shuffle'; enabled: boolean}
  | {action: 'flow'; flowId: string | null}
  | {action: 'enqueue'; tracks: Track[]; placement: 'next' | 'end'}
  | {action: 'seek'; entryId: string; positionMs: number}
  | {action: 'handoffPause'; entryId: string; revision: number}
  | {action: 'pause' | 'resume' | 'next' | 'previous'}
);
type Playable = Pick<Track, 'id' | 'title' | 'artist'> & {
  streamPath?: string | null; transcode?: boolean; durationMs?: number | null;
  albumName?: string | null; artworkPath?: string | null;
};
type AudioModule = {
  addListener(name: 'changed', listener: (event: Playback) => void): { remove(): void };
  connect(): Promise<void>; state(): Promise<Playback>; queueState(): Promise<QueueSnapshot>;
  queuePage(offset: number, limit: number): Promise<QueueSnapshot>;
  editQueue(edit: object): Promise<void>;
  play(server: string, headers: Record<string, string>, collection: string, tracks: Playable[], index: number, positionMs: number): Promise<void>;
  toggle(): Promise<void>; pause(): Promise<void>; resume(): Promise<void>;
  playUpcoming(currentId: string, id: string): Promise<void>;
  seek(positionMs: number): Promise<void>; skip(step: number): Promise<void>; clear(): Promise<void>;
};
export const audio = requireNativeModule<AudioModule>('AurralAudio');

// Resolving a Flow may take several requests. A newer selection supersedes an unfinished one.
let flowRequest: AbortController | undefined;
export async function editQueue(session: Connection, edit: QueueEdit) {
  if (edit.action === 'flow') {
    flowRequest?.abort();
    const controller = new AbortController();
    flowRequest = controller;
    const timer = setTimeout(() => controller.abort(), 8500);
    try {
      if (!edit.flowId) return await audio.editQueue({...edit, flowId: null, items: []});
      const list = await collections(session, controller.signal);
      const flow = list.find(c => c.kind === 'Flow' && c.id === edit.flowId);
      if (!flow) throw new Error('This Flow is unavailable.');
      const items = await tracks(session, flow, controller.signal);
      if (!items.length) throw new Error('This Flow has no playable songs.');
      if (controller.signal.aborted) throw new Error('Flow selection expired.');
      return await audio.editQueue({...edit, flowName: flow.name, items});
    } finally {
      clearTimeout(timer);
      if (flowRequest === controller) flowRequest = undefined;
    }
  }
  if (edit.action === 'enqueue') {
    return audio.editQueue({sessionId: edit.sessionId,
      action: edit.placement === 'next' ? 'insertNext' : 'append', items: edit.tracks});
  }
  return audio.editQueue(edit);
}

export async function play(session: Connection, collection: string, queue: Playable[], index: number, positionMs = 0) {
  if (!Number.isInteger(index) || !queue[index]) throw new Error('Choose a playable track.');
  if (!Number.isFinite(positionMs) || positionMs < 0) throw new Error('Invalid playback position.');
  const items = queue.map(t => ({
    id: t.id, title: t.title, artist: t.artist, streamPath: audioStreamPath(t),
    transcode: t.transcode !== false, durationMs: t.durationMs ?? null,
    albumName: t.albumName ?? null, artworkPath: t.artworkPath ?? null,
  }));
  const { headers } = serverResource(session, items[index].streamPath);
  await audio.connect();
  await audio.play(session.serverUrl, headers, collection, items, index, positionMs);
}
