import React, { useCallback, useState } from 'react';
import { findNodeHandle, Pressable, ScrollView, StyleSheet, Text, useTVEventHandler, useWindowDimensions, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import type { Connection } from './connection';
import type { Collection } from './api';
import { audio, editQueue, type Playback } from './audio';
import MetadataLink from './MetadataLink';
import { Artwork, Button, Icon, color, timeLabel } from './TvControls';

type Upcoming = Playback['upNext'][number];
type PressableRef = React.ComponentRef<typeof Pressable>;

function UpcomingSong({ session, collectionId, song, onPlay, firstRef }: {
  session: Connection;
  collectionId: string;
  song: Upcoming;
  onPlay: () => void;
  firstRef?: React.RefCallback<PressableRef>;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable ref={firstRef} accessibilityRole="button"
      accessibilityLabel={'Play ' + song.title + ', ' + song.artist}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      onPress={onPlay} style={[s.song, focused && s.focusedSong]}>
      <Artwork session={session} id={collectionId} size={43} track={song} />
      <View style={s.songCopy}>
        <Text numberOfLines={1} style={s.songTitle}>{song.title || 'Unknown title'}</Text>
        <Text numberOfLines={1} style={s.songArtist}>{song.artist}</Text>
      </View>
      {focused && <Icon name="play" size={13} />}
    </Pressable>
  );
}

function Progress({ playback, transport }: { playback: Playback; transport: (task: Promise<void>) => void }) {
  const duration = playback.durationMs ?? 0;
  const elapsed = Math.max(0, playback.positionMs);
  const [seekNode, setSeekNode] = useState<number>();
  const seekRef = useCallback((node: PressableRef | null) => setSeekNode(node ? findNodeHandle(node) ?? undefined : undefined), []);
  const [seeking, setSeeking] = useState(false);
  const skip = (delta: number) => transport(audio.seek(Math.max(0, Math.min(duration || Infinity, elapsed + delta))));
  useTVEventHandler(event => {
    if (!seeking || !playback.canSeek || Number(event.eventKeyAction) !== 1) return;
    if (event.eventType === 'left') skip(-10_000);
    if (event.eventType === 'right') skip(10_000);
  });
  return (
    <Pressable ref={seekRef} focusable={playback.canSeek} disabled={!playback.canSeek}
      nextFocusLeft={seekNode} nextFocusRight={seekNode} onFocus={() => setSeeking(true)} onBlur={() => setSeeking(false)}
      accessibilityRole={playback.canSeek ? 'adjustable' : 'progressbar'} accessibilityLabel="Playback position"
      accessibilityHint={playback.canSeek ? 'Press left or right to seek ten seconds.' : undefined}
      accessibilityValue={duration ? { min: 0, max: Math.ceil(duration / 1000), now: Math.min(Math.floor(elapsed / 1000), Math.ceil(duration / 1000)) } : undefined}
      accessibilityActions={playback.canSeek ? [{name: 'increment'}, {name: 'decrement'}] : undefined}
      onAccessibilityAction={({nativeEvent}) => {
        if (nativeEvent.actionName === 'increment') skip(10_000);
        if (nativeEvent.actionName === 'decrement') skip(-10_000);
      }}
      style={[s.progress, seeking && s.focusedSong]}>
      {duration > 0 && <View style={s.rail}>
        <View style={[s.fill, seeking && s.seekFill, { width: `${Math.min(100, elapsed / duration * 100)}%` }]} />
      </View>}
      <View style={s.times}>
        <Text style={s.time}>{timeLabel(elapsed)}</Text>
        {playback.buffering ? <Text accessibilityLiveRegion="polite" style={s.time}>Buffering…</Text> :
          seeking && <Text style={s.time}>‹ 10s · 10s ›</Text>}
        {duration > 0 && <Text style={s.time}>{timeLabel(duration)}</Text>}
      </View>
    </Pressable>
  );
}

export default function PlayerScreen({ session, playback, fromPocket, collection, error, transport, onOpenQueue, onOpenLyrics, onOpenMetadata, onBack }: {
  session: Connection;
  playback: Playback;
  fromPocket?: boolean;
  collection?: Collection;
  error: string;
  transport: (task: Promise<void>) => void;
  onOpenQueue: () => void;
  onOpenLyrics: () => void;
  onOpenMetadata: (kind: 'artist' | 'album') => void;
  onBack: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const collectionId = playback.collectionId || 'pocket-queue';
  const [firstSong, setFirstSong] = useState<number>();
  const firstRef = useCallback((node: PressableRef | null) => setFirstSong(node ? findNodeHandle(node) ?? undefined : undefined), []);
  const source = fromPocket || collectionId === 'pocket-queue' ? 'Playing from Pocket' : collection?.name || 'Now playing';
  const titleSize = Math.round(Math.min(height * 0.087, width * 0.046, 66));
  return (
    <View style={s.screen}>
      <View style={s.stage}>
        <View style={StyleSheet.absoluteFill} pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants">
          <Artwork session={session} id={collectionId} size={0} track={playback} backdrop />
          <Svg width="100%" height="100%" style={StyleSheet.absoluteFill} accessible={false}>
            <Defs><LinearGradient id="shade" x1="0" y1="0" x2="12%" y2="100%">
              <Stop offset="0%" stopColor="#090b0a" stopOpacity={0.57} />
              <Stop offset="36%" stopColor="#090b0a" stopOpacity={0.28} />
              <Stop offset="66%" stopColor="#090b0a" stopOpacity={0.82} />
              <Stop offset="100%" stopColor="#090b0a" stopOpacity={0.97} />
            </LinearGradient></Defs>
            <Rect width="100%" height="100%" fill="url(#shade)" />
          </Svg>
        </View>
        <View style={s.stageHeader}>
          <Button label="Back" icon="back" iconOnly onPress={onBack} />
          <Text numberOfLines={1} style={s.source}>{source}</Text>
          <Button label="Lyrics" icon="lyrics" onPress={onOpenLyrics} />
        </View>
        <View style={s.artworkRegion}>
          <Artwork session={session} id={collectionId} size={Math.round(Math.min(height * 0.28, 190))}
            track={playback} hideMissing fitHeight />
        </View>
        <View style={s.identity}>
          <Text numberOfLines={3} style={[s.title, {fontSize: titleSize, lineHeight: titleSize * 1.06}]}>{playback.title || 'Unknown title'}</Text>
          <MetadataLink kind="artist" name={playback.artist} style={s.artist} onOpen={onOpenMetadata} />
          <MetadataLink kind="album" name={playback.albumName} style={s.album} onOpen={onOpenMetadata} />
        </View>
        <Progress playback={playback} transport={transport} />
        <View style={s.transport}>
          <Button label={playback.shuffle ? 'Turn shuffle off' : 'Shuffle upcoming'} icon="shuffle" iconOnly primary={playback.shuffle}
            onPress={() => {
              if (playback.sessionId) transport(editQueue(session, {
                sessionId: playback.sessionId, action: 'shuffle', enabled: !playback.shuffle,
              }));
            }} />
          <Button label="Previous" icon="previous" iconOnly disabled={!playback.previous} onPress={() => transport(audio.skip(-1))} />
          <Button label={playback.playing ? 'Pause' : 'Play'} icon={playback.playing ? 'pause' : 'play'} primary iconOnly preferred
            nextFocusDown={firstSong} onPress={() => transport(audio.toggle())} />
          <Button label="Next" icon="next" iconOnly disabled={!playback.next} onPress={() => transport(audio.skip(1))} />
        </View>
        {!!(error || playback.message) && <Text accessibilityLiveRegion="polite" numberOfLines={2} style={s.notice}>{error || playback.message}</Text>}
      </View>
      <View style={s.sidebar}>
        <View style={s.queueHeader}>
          <Text accessibilityRole="header" style={s.queueTitle}>Up next</Text>
          <Button label="Manage queue" icon="queue" onPress={onOpenQueue} />
        </View>
        <ScrollView style={s.list} showsVerticalScrollIndicator={false}>
          {playback.upNext.length === 0 && <Text style={s.empty}>End of queue</Text>}
          {playback.upNext.map((item, index) => (
            <UpcomingSong key={item.entryId} session={session} collectionId={collectionId} song={item}
              firstRef={index === 0 ? firstRef : undefined}
              onPlay={() => { if (playback.sessionId) transport(editQueue(session, {
                sessionId: playback.sessionId, action: 'jump', entryId: item.entryId,
              })); }} />
          ))}
        </ScrollView>
        {!!playback.flowName && <View style={s.continuation}><Icon name="flow" tint={color.secondary} />
          <Text style={s.flowText} numberOfLines={1}>Then play {playback.flowName}</Text></View>}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, flexDirection: 'row', backgroundColor: '#101210' },
  stage: { flex: 1, paddingHorizontal: '4%', paddingTop: 19, paddingBottom: 21, overflow: 'hidden' },
  stageHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  source: { flex: 1, color: color.ink, fontSize: 16, fontWeight: '600', textShadowColor: '#161916', textShadowRadius: 5 },
  artworkRegion: { flex: 1, minHeight: 0, justifyContent: 'flex-end', alignItems: 'flex-start' },
  identity: { gap: 3, marginBottom: 9 },
  title: { color: '#fff', fontWeight: '800', letterSpacing: -1.2, marginTop: 4, includeFontPadding: false },
  artist: { color: color.ink, fontSize: 22, fontWeight: '600' },
  album: { color: '#ccd0ca', fontSize: 17 },
  progress: { borderRadius: 5, borderColor: 'transparent', borderWidth: 2, paddingHorizontal: 4, paddingVertical: 6 },
  rail: { height: 4, borderRadius: 3, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.3)' },
  fill: { backgroundColor: color.ink, height: '100%', borderRadius: 3 },
  seekFill: { backgroundColor: color.lime },
  times: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  time: { color: color.secondary, fontSize: 13, fontVariant: ['tabular-nums'] },
  transport: { flexDirection: 'row', gap: 6, justifyContent: 'center', alignItems: 'center', marginTop: 2 },
  notice: { color: color.error, fontSize: 14 },
  sidebar: { width: '36%', paddingTop: 24, paddingLeft: 14, paddingRight: '3%', paddingBottom: 18, backgroundColor: '#141715' },
  queueHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4, marginBottom: 8 },
  queueTitle: { color: color.ink, fontSize: 23, fontWeight: '700', letterSpacing: -0.5 },
  list: { flex: 1, width: '100%' },
  song: { width: '100%', minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 5,
    paddingVertical: 4, borderWidth: 2, borderColor: 'transparent', borderRadius: 5 },
  focusedSong: { borderColor: color.lime, backgroundColor: color.raised },
  songCopy: { flex: 1 },
  songTitle: { color: color.ink, fontSize: 16, fontWeight: '600' },
  songArtist: { color: color.muted, fontSize: 14, marginTop: 2 },
  empty: { color: color.muted, fontSize: 16, marginTop: 8 },
  continuation: { flexDirection: 'row', gap: 7, alignItems: 'center', paddingTop: 8 },
  flowText: { color: color.secondary, fontSize: 15, flex: 1 },
});
