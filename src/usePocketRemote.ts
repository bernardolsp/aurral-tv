import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { requireNativeModule } from 'expo';
import { getRandomValues } from 'expo-crypto';
import type { Connection } from './connection';
import type { Track } from './api';
import { albumArtworkPath } from './playlistStreams';
import { audioStreamPath } from './connection';
import { audio, play, editQueue } from './audio';
import { queueEdit, snapshotPage } from './sharedQueueWire';
import { openRemote, sealRemote } from './remoteEnvelope';

type RemoteModule = {
  start(): Promise<void>;
  stop(): Promise<void>;
  finish(challenge: string, reply: string): Promise<void>;
  addListener(
    name: 'command',
    cb: (data: { challenge: string; body: string }) => void,
  ): { remove(): void };
};

const receiver = requireNativeModule<RemoteModule>('AurralPocketRemote');
function wireTrack(raw: unknown): Track {
  if (!raw || typeof raw !== 'object') throw new Error();
  const t = raw as Record<string, unknown>;
  if (
    typeof t.id !== 'string' ||
    !t.id ||
    t.id.length > 384 ||
    typeof t.title !== 'string' ||
    t.title.length > 512 ||
    typeof t.artist !== 'string' ||
    t.artist.length > 512 ||
    typeof t.streamPath !== 'string' ||
    t.streamPath.length > 512
  )
    throw new Error();
  const durationMs =
    typeof t.durationMs === 'number' && Number.isSafeInteger(t.durationMs) && t.durationMs > 0
      ? t.durationMs
      : null;
  const streamPath = audioStreamPath({ id: t.id, streamPath: t.streamPath });
  const smallMp3 =
    typeof t.audioFormat === 'string' &&
    t.audioFormat.toLowerCase() === 'mp3' &&
    typeof t.bitrateKbps === 'number' &&
    t.bitrateKbps > 0 &&
    t.bitrateKbps <= 320;
  return {
    id: t.id,
    title: t.title,
    artist: t.artist,
    streamPath,
    durationMs,
    transcode: !smallMp3,
    albumName: typeof t.albumName === 'string' ? t.albumName.slice(0, 512) : null,
    artworkPath: albumArtworkPath(t.artworkPath),
  };
}

export function usePocketRemote(
  session: Connection | null,
  onCast: (collection: string | null) => void,
) {
  const show = useRef(onCast);
  show.current = onCast;
  useEffect(() => {
    const remoteKey = session?.remoteKey;
    if (!session || !remoteKey) return;
    let active = true;
    const onState = (state: string) => {
      if (state === 'active') void receiver.start().catch(() => {});
      else void receiver.stop().catch(() => {});
    };
    async function receive({ challenge, body }: { challenge: string; body: string }) {
      if (!active || !session || !remoteKey) return;
      let answer = '';
      try {
        const raw = openRemote(body, remoteKey) as Record<string, unknown> | null;
        if (!raw || raw.v !== 1 || raw.kind !== 'command' || raw.challenge !== challenge)
          throw new Error();
        try {
          if (!active) throw new Error();
          let snapshot;
          if (raw.action === 'play') {
            if (!Array.isArray(raw.tracks) || raw.tracks.length < 1 || raw.tracks.length > 100)
              throw new Error();
            const queue = raw.tracks.map(wireTrack);
            const index = raw.index;
            if (
              typeof index !== 'number' ||
              !Number.isInteger(index) ||
              index < 0 ||
              index >= queue.length
            )
              throw new Error();
            const id = raw.collectionId;
            if (id != null && (typeof id !== 'string' || id.length > 256)) throw new Error();
            const positionMs = raw.positionMs ?? 0;
            if (
              typeof positionMs !== 'number' ||
              !Number.isSafeInteger(positionMs) ||
              positionMs < 0 ||
              positionMs > 86_400_000
            )
              throw new Error();
            await play(session, id || 'pocket-queue', queue, index, positionMs);
            if (active) show.current(id || null);
          } else if (raw.action === 'snapshot') {
            snapshot = await snapshotPage(raw, (offset, limit) => audio.queuePage(offset, limit));
          } else if (raw.sessionId !== undefined) {
            await editQueue(session, queueEdit(raw, wireTrack));
          } else if (raw.action === 'pause' || raw.action === 'resume') {
            const state = await audio.state();
            if (!state.id) throw new Error();
            if (raw.action === 'resume') await audio.resume();
            else await audio.pause();
          } else if (raw.action === 'next' || raw.action === 'previous') {
            const state = await audio.state();
            if (!(raw.action === 'next' ? state.next : state.previous)) throw new Error();
            await audio.skip(raw.action === 'next' ? 1 : -1);
          } else if (raw.action !== 'status') throw new Error();
          const state = await audio.state();
          answer = sealRemote(
            {
              v: 1,
              kind: 'reply',
              challenge,
              ok: true,
              playing: state.playing,
              title: state.title || '',
              ...(snapshot && {snapshot}),
            },
            remoteKey,
            getRandomValues,
          );
        } catch {
          answer = sealRemote(
            {
              v: 1,
              kind: 'reply',
              challenge,
              ok: false,
              playing: false,
              error: 'The TV could not play that request.',
            },
            remoteKey,
            getRandomValues,
          );
        }
      } catch {
        /* Unauthenticated requests receive no playback information. */
      } finally {
        await receiver.finish(challenge, answer).catch(() => {});
      }
    }
    const sub = receiver.addListener('command', (args) => {
      void receive(args);
    });
    const lifecycle = AppState.addEventListener('change', onState);
    onState(AppState.currentState ?? 'active');
    return () => {
      active = false;
      sub.remove();
      lifecycle.remove();
      void receiver.stop().catch(() => {});
    };
  }, [session]);
}
