import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import * as api from './src/api';
import { audio, editQueue, play, type Playback } from './src/audio';
import { serverAddress, type Connection, type Setup } from './src/connection';
import { clearSession, getSession, saveSession } from './src/session';
import { CollectionDetails, Library } from './src/LibraryScreen';
import { MusicLibraryScreen } from './src/MusicLibraryScreen';
import LyricsScreen from './src/LyricsScreen';
import PlayerScreen from './src/PlayerScreen';
import { FlowPicker, QueueScreen } from './src/QueueScreen';
import SetupScreen from './src/SetupScreen';
import { Artwork, Brand, Button, Icon, color } from './src/TvControls';
import { usePocketRemote } from './src/usePocketRemote';

type Page = 'music' | 'lyrics' | 'home' | 'tracks' | 'player' | 'queue' | 'flows' | 'remote' | 'settings';
function message(e: unknown) {
  return e instanceof Error ? e.message : 'Could not reach Aurral.';
}

function ReturnToPlayer({session, playback, onPress}: {
  session: Connection; playback: Playback; onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
  return <Pressable accessibilityRole="button" accessibilityLabel={'Now playing, ' + (playback.title || 'Unknown title')}
    onPress={onPress} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    style={[s.playerLink, focused && s.playerLinkFocus]}>
    <Artwork session={session} id={playback.collectionId ?? 'pocket-queue'} size={34} track={playback} />
    <View style={s.nowPlayingCopy}>
      <Text numberOfLines={1} style={s.nowPlayingTitle}>{playback.title || 'Unknown title'}</Text>
      <Text numberOfLines={1} style={s.nowPlayingArtist}>{playback.artist}</Text>
    </View>
    <Icon name={playback.playing ? 'sound' : 'pause'} tint={color.lime} size={16} />
  </Pressable>;
}

export default function App() {
  const [session, setSession] = useState<Connection | null>(null);
  const [ready, setReady] = useState(false);
  const [page, setPage] = useState<Page>('home');
  const [parent, setParent] = useState<'home' | 'tracks' | 'music'>('home');
  const [selected, setSelected] = useState<api.Collection | null>(null);
  const [cursor, setCursor] = useState('');
  const [catalog, setCatalog] = useState<api.Collection[]>([]);
  const [queue, setQueue] = useState<api.Track[]>([]);
  const [fromPocket, setFromPocket] = useState(false);
  const [playback, setPlayback] = useState<Playback | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const activePair = useRef(false);
  const musicBack = useRef<(() => boolean) | null>(null);
  const [musicSource, setMusicSource] = useState('Library');

  const cast = useCallback((_collectionId: string | null) => {
    setFromPocket(true);
    setError('');
    setParent('home');
    setPage('player');
    void audio
      .state()
      .then(setPlayback)
      .catch((e) => setError(message(e)));
  }, []);
  usePocketRemote(session, cast);

  useEffect(() => {
    let active = true;
    void getSession()
      .then((result) => {
        if (active) setSession(result);
      })
      .catch(() => {
        if (active) setError('Could not read the saved session.');
      })
      .finally(() => {
        if (active) setReady(true);
      });
    const event = audio.addListener('changed', (update) => {
      if (active) setPlayback(update);
    });
    void audio
      .connect()
      .then(() => audio.state())
      .then((result) => {
        if (active) setPlayback(result);
      })
      .catch(() => {
        if (active) setError('Could not start the audio service.');
      });
    return () => {
      active = false;
      event.remove();
    };
  }, []);

  const forget = useCallback(
    async (local: boolean) => {
      await clearSession();
      setFromPocket(false);
      await audio.clear();
      setSession(null);
      setPage('home');
      setSelected(null);
      setCatalog([]);
      setQueue([]);
      setCursor('');
      setError('');
      if (!local && session) void api.logout(session).catch(() => {});
    },
    [session],
  );

  useEffect(() => {
    if (!session || (page !== 'home' && page !== 'tracks')) return;
    let active = true;
    setBusy(true);
    setError('');
    const task =
      page === 'tracks' && selected
        ? api.tracks(session, selected).then((result) => {
            if (active) setQueue(result);
          })
        : api.collections(session).then((result) => {
            if (active) setCatalog(result);
          });
    void task
      .catch((e) => {
        if (!active) return;
        if (e instanceof api.ExpiredSession) void forget(true).catch((err) => setError(message(err)));
        else setError(message(e));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [session, selected, page, revision, forget]);

  const back = useCallback(() => {
    setError('');
    if (page === 'music' && musicBack.current?.()) return true;
    if (page === 'lyrics' || page === 'flows' || page === 'queue') {
      setPage(page === 'flows' ? 'queue' : 'player');
      return true;
    }
    if (page === 'player') {
      setPage(parent);
      return true;
    }
    if (page !== 'home') {
      setPage('home');
      return true;
    }
    return false;
  }, [page, parent]);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', back);
    return () => sub.remove();
  }, [back]);

  async function pair(setup: Setup, acknowledge?: () => Promise<void>) {
    if (activePair.current) throw new Error('Pairing is already in progress.');
    if (session && serverAddress(setup.serverUrl) !== session.serverUrl) {
      throw new Error('Use Pocket with the same Aurral server as this TV.');
    }
    activePair.current = true;
    try {
      const next = await api.pair(setup);
      let paired = next;
      try {
        if (session) {
          if (!next.remoteKey) throw new Error('Update Pocket to pair it as a TV remote.');
          const [tvUser, phoneUser] = await Promise.all([api.accountId(session), api.accountId(next)]);
          if (tvUser !== phoneUser)
            throw new Error('Sign into Pocket with the same Aurral account as this TV.');
          paired = { ...session, remoteKey: next.remoteKey };
        }
        await saveSession(paired);
        try {
          await acknowledge?.();
        } catch (e) {
          if (session) await saveSession(session);
          else await clearSession();
          throw e;
        }
      } catch (e) {
        if (session?.token !== next.token) await api.logout(next).catch(() => {});
        throw e;
      }
      setSession(paired);
      setPage('home');
      setError('');
      if (paired.token !== next.token) void api.logout(next).catch(() => {});
    } finally {
      activePair.current = false;
    }
  }

  const expire = useCallback(() => {
    void forget(true).catch(e => setError(message(e)));
  }, [forget]);

  function open(collection: api.Collection) {
    setSelected(collection);
    setCursor('');
    setQueue([]);
    setPage('tracks');
  }

  function transport(task: Promise<void>) {
    setError('');
    void task.catch((e) => setError(message(e)));
  }

  if (!ready)
    return (
      <View style={s.center}>
        <ActivityIndicator accessibilityLabel="Loading Aurral" color={color.lime} />
      </View>
    );
  if (!session || page === 'remote')
    return <SetupScreen onPair={pair} remote={!!session} onBack={session ? back : undefined} />;
  const currentCollection = catalog.find(c => c.id === playback?.collectionId) ??
    (playback?.collectionId === 'music-library' ? {id:'music-library',name:musicSource,kind:'Playlist' as const} : undefined);
  const playerVisible = page === 'player' && !!playback?.id;
  const keepMusic = page === 'music' || (parent === 'music' && ['player','queue','flows','lyrics'].includes(page));
  const libraryPage = page === 'home' || page === 'tracks';
  return (
    <View style={playerVisible ? s.full : s.screen}>
      {playerVisible && playback ? <PlayerScreen session={session} playback={playback} fromPocket={fromPocket}
        collection={currentCollection} error={error} transport={transport} onBack={back}
        onOpenLyrics={() => setPage('lyrics')} onOpenQueue={() => setPage('queue')} /> :
      <View style={s.header}>
        <Brand />
        <View style={s.actions}>
          {page === 'home' && <Button label="Library" icon="library" onPress={() => setPage('music')} />}
          {page !== 'home' && <Button label="Back" icon="back" onPress={back} />}
          {(libraryPage || page === 'music') && playback?.id && (
            <ReturnToPlayer
              session={session} playback={playback}
              onPress={() => {
                setParent(page === 'music' ? 'music' : page === 'tracks' ? 'tracks' : 'home');
                setPage('player');
              }}
            />
          )}
          {(libraryPage || page === 'music') && (
            <Button label="Refresh" icon="refresh" iconOnly onPress={() => setRevision((n) => n + 1)} />
          )}
          {page === 'home' && <Button label="Settings" icon="settings" iconOnly onPress={() => setPage('settings')} />}
        </View>
      </View>}
      {keepMusic && <View style={page === 'music' ? s.full : s.hidden}
        accessibilityElementsHidden={page !== 'music'} importantForAccessibility={page === 'music' ? 'auto' : 'no-hide-descendants'}>
        <MusicLibraryScreen session={session} active={page === 'music'} revision={revision} backRef={musicBack}
          canQueue={!!playback?.sessionId} onExpired={expire}
          onPlay={async (items, index, source) => {
            await play(session, 'music-library', items, index);
            setPlayback(await audio.state());
            setFromPocket(false);
            setMusicSource(source || 'Library');
            setParent('music');
            setError('');
            setPage('player');
          }}
          onEnqueue={async (items, placement) => {
            if (!playback?.sessionId) throw new Error('Start playback to add to the queue.');
            await editQueue(session,{sessionId:playback.sessionId,action:'enqueue',tracks:items,placement});
          }} />
      </View>}
      {page === 'music' || playerVisible ? null : page === 'lyrics' && playback?.id ?
        <LyricsScreen key={playback.currentEntryId ?? playback.id} session={session} playback={playback} onExpired={expire} /> :
        page === 'settings' ? (
        <View style={s.settings}>
          <Text accessibilityRole="header" style={s.heading}>Settings</Text>
          <Button preferred label="Pair Pocket remote" icon="phone" onPress={() => setPage('remote')} />
          <Button label="Disconnect" icon="disconnect" onPress={() => transport(forget(false))} />
          {!!error && <Text style={s.notice}>{error}</Text>}
        </View>
      ) : page === 'queue' && playback?.id ? (
        <QueueScreen session={session} playback={playback} onOpenFlows={() => setPage('flows')} />
      ) : page === 'flows' && playback?.id ? (
        <FlowPicker session={session} playback={playback} onDone={() => setPage('queue')} />
      ) : !libraryPage ? (
        <View style={s.center}><Text style={s.status}>{error || 'Nothing playing'}</Text></View>
      ) : busy ? (
        <View style={s.center}>
          <ActivityIndicator accessibilityLabel="Loading library" color={color.lime} />
        </View>
      ) : error ? (
        <View style={s.center}>
          <Text accessibilityLiveRegion="polite" style={s.notice}>
            {error}
          </Text>
          <Button label="Try again" icon="refresh" preferred onPress={() => setRevision((n) => n + 1)} />
        </View>
      ) : page === 'tracks' && selected ? (
        <CollectionDetails
          session={session}
          collection={selected}
          tracks={queue}
          cursor={cursor}
          playingId={playback?.collectionId === selected.id ? playback.id : null}
          onPlay={(index) => {
            setCursor(queue[index].id);
            transport(
              play(session, selected.id, queue, index).then(async () => {
                setFromPocket(false);
                setPlayback(await audio.state());
                setParent('tracks');
                setPage('player');
              }),
            );
          }}
        />
      ) : (
        <Library session={session} items={catalog} last={selected} onOpen={open} />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  hidden: { display: 'none' },
  full: { flex: 1, backgroundColor: color.bg },
  screen: { flex: 1, backgroundColor: color.bg, paddingHorizontal: '4.5%', paddingTop: 18, paddingBottom: 18 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: color.bg, gap: 12 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 18,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.border,
  },
  actions: { flexDirection: 'row', gap: 7, alignItems: 'center' },
  playerLink: { flexDirection: 'row', height: 46, gap: 8, alignItems: 'center', paddingHorizontal: 6,
    borderRadius: 5, borderWidth: 2, borderColor: 'transparent' },
  playerLinkFocus: { borderColor: color.lime, backgroundColor: color.raised },
  nowPlayingCopy: { maxWidth: 188 },
  nowPlayingTitle: { color: color.ink, fontWeight: '600', fontSize: 14 },
  nowPlayingArtist: { color: color.secondary, fontSize: 12 },
  notice: { color: color.error, fontSize: 17 },
  status: { color: color.secondary, fontSize: 18 },
  settings: { paddingTop: 24, gap: 12, alignItems: 'flex-start' },
  heading: { color: color.ink, fontSize: 30, fontWeight: '700' },
});
