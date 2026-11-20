import { requireNativeModule } from 'expo';
import type { Track } from './api';
import { serverResource, type Connection } from './connection';

export type Playback = { id: string | null; title: string | null; artist: string | null; collectionId: string | null;
  playing: boolean; previous: boolean; next: boolean; message: string | null };
type AudioModule = {
  addListener(name: 'changed', listener: (event: Playback) => void): { remove(): void };
  connect(): Promise<void>; state(): Promise<Playback>;
  play(server: string, headers: Record<string, string>, collection: string, tracks: Track[], index: number): Promise<void>;
  toggle(): Promise<void>; skip(step: number): Promise<void>; clear(): Promise<void>;
};
export const audio = requireNativeModule<AudioModule>('AurralAudio');
export async function play(session: Connection, collection: string, queue: Track[], index: number) {
  await audio.connect();
  const { headers } = serverResource(session, '/api/playlists/stream/');
  await audio.play(session.serverUrl, headers, collection, queue, index);
}
