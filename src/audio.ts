import { requireNativeModule } from 'expo';
import type { Track } from './api';
import { audioStreamPath, serverResource, type Connection } from './connection';

export type Playback = {
  id: string | null; title: string | null; artist: string | null; collectionId: string | null;
  albumName: string | null; artworkPath: string | null;
  playing: boolean; buffering: boolean; previous: boolean; next: boolean; message: string | null;
  upNext: {id: string; title: string; artist: string; albumName: string | null; artworkPath: string | null}[];
  positionMs: number; durationMs: number | null; canSeek: boolean;
};
type Playable = Pick<Track, 'id' | 'title' | 'artist'> & {
  streamPath?: string | null; transcode?: boolean; durationMs?: number | null;
  albumName?: string | null; artworkPath?: string | null;
};
type AudioModule = {
  addListener(name: 'changed', listener: (event: Playback) => void): { remove(): void };
  connect(): Promise<void>; state(): Promise<Playback>;
  play(server: string, headers: Record<string, string>, collection: string, tracks: Playable[], index: number, positionMs: number): Promise<void>;
  toggle(): Promise<void>; pause(): Promise<void>; resume(): Promise<void>;
  playUpcoming(currentId: string, id: string): Promise<void>;
  seek(positionMs: number): Promise<void>; skip(step: number): Promise<void>; clear(): Promise<void>;
};
export const audio = requireNativeModule<AudioModule>('AurralAudio');

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
