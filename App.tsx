import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, FlatList, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import PhoneSetup from './src/PhoneSetup';
import * as api from './src/api';
import { audio, play, type Playback } from './src/audio';
import type { Connection, Setup } from './src/connection';
import { clearSession, getSession, saveSession } from './src/session';

const color = { bg: '#10150f', panel: '#252e24', ink: '#f3f5ef', muted: '#acb9a7', green: '#b7ed82' };
type Page = 'home' | 'tracks' | 'player';
function message(e: unknown) { return e instanceof Error ? e.message : 'Could not reach Aurral.'; }

function Action({ text, onPress, preferred, wide, caption, disabled }: {
  text: string; onPress: () => void; preferred?: boolean; wide?: boolean; caption?: string; disabled?: boolean;
}) {
  const [focus, setFocus] = useState(false);
  return <Pressable accessibilityRole="button" accessibilityLabel={text} disabled={disabled}
    hasTVPreferredFocus={preferred} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
    style={[s.action, wide && s.wide, focus && s.selected, disabled && s.disabled]} onPress={onPress}>
    <Text numberOfLines={1} style={[s.actionText, focus && s.selectedText]}>{text}</Text>
    {caption ? <Text numberOfLines={1} style={[s.caption, focus && s.selectedText]}>{caption}</Text> : null}
  </Pressable>;
}

function Artwork({ session, id }: { session: Connection; id: string }) {
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setUri(null);
    void api.cover(session, id, controller.signal).then(value => {
      if (!controller.signal.aborted) setUri(value);
    }).catch(() => {});
    return () => controller.abort();
  }, [session, id]);
  return <Image accessibilityIgnoresInvertColors source={uri ? {uri} : require('./assets/icon.png')} style={s.art} />;
}

function SetupScreen({ onPair }: { onPair: (setup: Setup) => Promise<void> }) {
  const [serverUrl, setUrl] = useState('');
  const [code, setCode] = useState('');
  const [manual, setManual] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!manual) return false;
      setManual(false);
      return true;
    });
    return () => sub.remove();
  }, [manual]);
  return <ScrollView contentContainerStyle={s.setup} keyboardShouldPersistTaps="handled">
    {manual ? <>
      <Text style={s.title}>Pair with a code</Text>
      <Text style={s.subtitle}>On your server, open Settings → Profile → Pair a device.</Text>
      <TextInput accessibilityLabel="Server address" placeholder="https://your-server" placeholderTextColor={color.muted}
        autoCapitalize="none" autoCorrect={false} style={s.input} value={serverUrl} onChangeText={setUrl} />
      <TextInput accessibilityLabel="Pairing code" placeholder="Pairing code" placeholderTextColor={color.muted}
        autoCapitalize="characters" autoCorrect={false} style={s.input} value={code} onChangeText={setCode} />
      <View style={s.row}><Action text={busy ? 'Pairing…' : 'Pair TV'} disabled={busy} onPress={() => {
        setError(''); setBusy(true);
        void onPair({serverUrl, code, customHeaders: {}}).catch(e => setError(message(e))).finally(() => setBusy(false));
      }} /><Action text="Use Pocket" onPress={() => setManual(false)} /></View>
      {error ? <Text style={s.notice}>{error}</Text> : null}
    </> : <>
      <Text style={s.title}>Set up Aurral TV</Text>
      <Text style={s.subtitle}>Bring your server connection from Pocket or enter a pairing code.</Text>
      <PhoneSetup onReceive={onPair} />
      <Action text="Enter server and pairing code" onPress={() => setManual(true)} />
    </>}
  </ScrollView>;
}

export default function App() {
  const [session, setSession] = useState<Connection | null>(null);
  const [ready, setReady] = useState(false);
  const [page, setPage] = useState<Page>('home');
  const [parent, setParent] = useState<Page>('home');
  const [selected, setSelected] = useState<api.Collection | null>(null);
  const [cursor, setCursor] = useState('');
  const [catalog, setCatalog] = useState<api.Collection[]>([]);
  const [queue, setQueue] = useState<api.Track[]>([]);
  const [playback, setPlayback] = useState<Playback | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const activePair = useRef(false);
  const loadTracks = page !== 'home' && !!selected;
  useEffect(() => {
    let active = true;
    void getSession().then(result => { if (active) setSession(result); })
      .catch(() => { if (active) setError('Could not read the saved session.'); }).finally(() => { if (active) setReady(true); });
    const event = audio.addListener('changed', update => { if (active) setPlayback(update); });
    void audio.connect().then(() => audio.state()).then(result => { if (active) setPlayback(result); })
      .catch(() => { if (active) setError('Could not start the audio service.'); });
    return () => { active = false; event.remove(); };
  }, []);

  async function forget(local: boolean) {
    const old = session;
    await clearSession();
    await audio.clear();
    setSession(null); setPage('home'); setSelected(null); setCatalog([]); setQueue([]); setCursor(''); setError('');
    if (!local && old) void api.logout(old).catch(() => {});
  }

  useEffect(() => {
    if (!session) return;
    let active = true;
    setBusy(true); setError('');
    const task = loadTracks && selected
      ? api.tracks(session, selected).then(result => { if (active) setQueue(result); })
      : api.collections(session).then(result => { if (active) setCatalog(result); });
    void task.catch(e => {
      if (!active) return;
      if (e instanceof api.ExpiredSession) void forget(true).catch(err => setError(message(err)));
      else setError(message(e));
    }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [session, selected, loadTracks, revision]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (page === 'player') { setPage(parent); return true; }
      if (page === 'tracks') { setPage('home'); return true; }
      return false;
    });
    return () => sub.remove();
  }, [page, parent]);

  async function pair(setup: Setup) {
    if (activePair.current) throw new Error('Pairing is already in progress.');
    activePair.current = true;
    try {
      const newSession = await api.pair(setup);
      try { await saveSession(newSession); }
      catch (e) { await api.logout(newSession).catch(() => {}); throw e; }
      setSession(newSession); setPage('home'); setError('');
    } finally { activePair.current = false; }
  }
  function openPlayer() { setParent(page); setPage('player'); }
  function transport(task: Promise<void>) { void task.catch(e => setError(message(e))); }

  if (!ready) return <View style={s.center}><ActivityIndicator color={color.green}/></View>;
  if (!session) return <SetupScreen onPair={pair} />;
  return <View style={s.screen}>
    {page === 'player' && playback?.id && playback.collectionId ? <View style={s.playing}>
      <Artwork session={session} id={playback.collectionId} />
      <View style={s.playingText}>
        <Text style={s.kicker}>NOW PLAYING</Text>
        <Text style={s.trackTitle} numberOfLines={3}>{playback.title}</Text>
        <Text style={s.subtitle}>{playback.artist}</Text>
        <View style={s.row}>
          {playback.previous && <Action text="Previous" onPress={() => transport(audio.skip(-1))} />}
          <Action preferred text={playback.playing ? 'Pause' : 'Play'} onPress={() => transport(audio.toggle())} />
          {playback.next && <Action text="Next" onPress={() => transport(audio.skip(1))} />}
        </View>
        {!!(playback.message || error) && <Text style={s.notice}>{playback.message || error}</Text>}
      </View>
    </View> : <>
      <View style={s.header}>
        <View style={s.headerTitle}><Text style={s.kicker}>{page === 'tracks' ? selected?.kind.toUpperCase() : 'AURRAL TV'}</Text>
          <Text style={s.title} numberOfLines={1}>{page === 'tracks' ? selected?.name : 'Playlists & Flows'}</Text></View>
        <View style={s.row}>
          {playback?.id && <Action text="Now playing" onPress={openPlayer} />}
          <Action text="Refresh" onPress={() => setRevision(n => n + 1)} />
          {page === 'home' && <Action text="Disconnect" onPress={() => transport(forget(false))} />}
        </View>
      </View>
      {busy ? <ActivityIndicator color={color.green} /> : error ? <Text style={s.notice}>{error}</Text> :
        page === 'tracks' && selected ? <FlatList key={selected.id} data={queue} keyExtractor={t => t.id}
          ListEmptyComponent={<Text style={s.subtitle}>No downloaded tracks to play.</Text>}
          renderItem={({item, index}) => <Action wide text={item.title} caption={item.artist} preferred={cursor ? cursor === item.id : index === 0}
            onPress={() => {
              setCursor(item.id);
              transport(play(session, selected.id, queue, index).then(async () => {
                setPlayback(await audio.state()); setParent('tracks'); setPage('player');
              }));
            }} />} /> :
          <FlatList key="home" data={catalog} keyExtractor={item => item.kind + ':' + item.id}
            ListEmptyComponent={<Text style={s.subtitle}>No playlists or Flows yet.</Text>}
            renderItem={({item, index}) => <Action wide text={item.name} caption={item.kind}
              preferred={selected ? selected.id === item.id : index === 0}
              onPress={() => { setSelected(item); setCursor(''); setQueue([]); setPage('tracks'); }} />} />}
    </>}
  </View>;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg, paddingHorizontal: 46, paddingVertical: 26 },
  setup: { flexGrow: 1, justifyContent: 'center', alignItems: 'flex-start', gap: 12, paddingHorizontal: 48, paddingVertical: 20, backgroundColor: color.bg },
  center: { flex: 1, justifyContent: 'center', backgroundColor: color.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, gap: 12 },
  headerTitle: { flex: 1 }, title: { fontSize: 31, color: color.ink, fontWeight: '700' },
  subtitle: { fontSize: 19, color: color.muted }, kicker: { color: color.green, fontWeight: '700', fontSize: 12, letterSpacing: 1, marginBottom: 5 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  action: { borderRadius: 8, paddingHorizontal: 15, paddingVertical: 10, backgroundColor: color.panel, minHeight: 40, justifyContent: 'center' },
  actionText: { color: color.ink, fontSize: 17, fontWeight: '600' }, selected: { backgroundColor: color.green }, selectedText: { color: color.bg },
  wide: { marginBottom: 6, paddingHorizontal: 18, minHeight: 52 }, caption: { color: color.muted, fontSize: 14 },
  disabled: { opacity: 0.55 }, notice: { color: '#ffbf8c', fontSize: 16 },
  input: { backgroundColor: color.panel, minWidth: 360, borderRadius: 6, color: color.ink, fontSize: 18, paddingHorizontal: 14, paddingVertical: 9 },
  playing: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 32 }, art: { width: '34%', aspectRatio: 1, borderRadius: 12, backgroundColor: color.panel },
  playingText: { flex: 1, gap: 12 }, trackTitle: { color: color.ink, fontSize: 38, fontWeight: '700' },
});
