import React, { useCallback, useState } from 'react';
import { findNodeHandle, FlatList, Pressable, StyleSheet, Text, useTVEventHandler, useWindowDimensions, View } from 'react-native';
import type { Connection } from './connection';
import type { Collection } from './api';
import { audio, type Playback } from './audio';
import { Artwork, Button, color, timeLabel } from './TvControls';

function UpcomingSong({
  session,
  collectionId,
  song,
  index,
  width,
  onPlay,
  firstRef,
  loadArt,
}: {
  session: Connection;
  collectionId: string;
  song: Playback['upNext'][number];
  index: number;
  width: number;
  onPlay: () => void;
  loadArt: boolean;
  firstRef?: React.RefCallback<React.ComponentRef<typeof Pressable>>;
}) {
  const [focus, setFocus] = useState(false);
  return (
    <Pressable
      ref={firstRef}
      accessibilityRole="button"
      accessibilityLabel={'Play ' + song.title + ', ' + song.artist}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      onPress={onPlay}
      style={[s.song, { width }, focus && s.focusedSong]}
    >
      {loadArt && (song.artworkPath || song.albumName) ? (
        <Artwork session={session} id={collectionId} size={42} track={song} />
      ) : (
        <Text style={s.upcomingNumber}>{index + 1}</Text>
      )}
      <View style={s.songText}>
        <Text numberOfLines={focus ? 2 : 1} style={s.songTitle}>
          {song.title}
        </Text>
        <Text numberOfLines={1} style={s.songArtist}>
          {song.artist}
        </Text>
      </View>
    </Pressable>
  );
}

export default function PlayerScreen({
  session,
  playback,
  fromPocket,
  collection,
  error,
  transport,
}: {
  session: Connection;
  playback: Playback;
  fromPocket?: boolean;
  collection?: Collection;
  error: string;
  transport: (task: Promise<void>) => void;
}) {
  const { width, height } = useWindowDimensions();
  const size = Math.round(Math.min(width * 0.36, height * (playback.upNext.length ? 0.52 : 0.66), 470));
  const duration = playback.durationMs ?? 0;
  const elapsed = Math.max(0, playback.positionMs);
  const skipTime = (delta: number) =>
    transport(audio.seek(Math.max(0, Math.min(duration || Infinity, elapsed + delta))));
  const collectionId = playback.collectionId || 'pocket-queue';
  const [visibleSongs, setVisibleSongs] = useState<number[]>([0,1,2]);
  const onViewableItemsChanged = useCallback(({viewableItems}: {viewableItems: {index?: number | null}[]}) => {
    const indices = viewableItems.flatMap(item => item.index == null ? [] : [item.index]);
    setVisibleSongs(old => old.join(',') === indices.join(',') ? old : indices);
  }, []);
  const [firstSong, setFirstSong] = useState<number>();
  const firstRef = useCallback((node: React.ComponentRef<typeof Pressable> | null) => setFirstSong(node ? findNodeHandle(node) ?? undefined : undefined), []);
  const [seekNode, setSeekNode] = useState<number>();
  const seekRef = useCallback((node: React.ComponentRef<typeof Pressable> | null) => setSeekNode(node ? findNodeHandle(node) ?? undefined : undefined), []);
  const [seeking, setSeeking] = useState(false);
  useTVEventHandler(event => {
    if (!seeking || !playback.canSeek || Number(event.eventKeyAction) !== 1) return;
    if (event.eventType === 'left') skipTime(-10_000);
    if (event.eventType === 'right') skipTime(10_000);
  });
  return (
    <View style={s.screen}>
      <View style={s.columns}>
        <Artwork
          session={session}
          id={collectionId}
          flow={collection?.kind === 'Flow'}
          size={size}
          track={playback}
        />
        <View style={s.copy}>
          <Text style={s.kicker}>{fromPocket || playback.collectionId === 'pocket-queue' ? 'PLAYING FROM POCKET' : 'NOW PLAYING'}</Text>
          <Text numberOfLines={2} style={s.title}>
            {playback.title || 'Unknown title'}
          </Text>
          <Text numberOfLines={2} style={s.artist}>
            {playback.artist}
          </Text>
          {!!(playback.albumName || collection?.name) && (
            <Text style={s.collection} numberOfLines={1}>
              {playback.albumName || collection?.name}
            </Text>
          )}
          <Pressable
            ref={seekRef}
            focusable={playback.canSeek}
            disabled={!playback.canSeek}
            nextFocusLeft={seekNode}
            nextFocusRight={seekNode}
            onFocus={() => setSeeking(true)}
            onBlur={() => setSeeking(false)}
            accessible
            accessibilityRole={playback.canSeek ? 'adjustable' : 'progressbar'}
            accessibilityLabel="Playback position"
            accessibilityHint={playback.canSeek ? "Press left or right to seek ten seconds." : undefined}
            accessibilityValue={duration ? { min: 0, max: Math.ceil(duration / 1000), now: Math.min(Math.floor(elapsed / 1000), Math.ceil(duration / 1000)) } : undefined}
            accessibilityActions={playback.canSeek ? [{name: 'increment'}, {name: 'decrement'}] : undefined}
            onAccessibilityAction={({nativeEvent}) => {
              if (!playback.canSeek) return;
              if (nativeEvent.actionName === 'increment') skipTime(10_000);
              if (nativeEvent.actionName === 'decrement') skipTime(-10_000);
            }}
            style={[s.progress, seeking && s.seekFocused]}
          >
            {duration > 0 && (
              <View style={s.rail}>
                <View style={[s.fill, { width: `${Math.min(100, (elapsed / duration) * 100)}%` }]} />
              </View>
            )}
            <View style={s.times}>
              <Text style={s.time}>{timeLabel(elapsed)}</Text>
              {playback.buffering && (
                <Text accessibilityLiveRegion="polite" style={s.time}>
                  Buffering…
                </Text>
              )}
              {seeking && !playback.buffering && <Text style={s.seekHint}>‹ 10s  ·  10s ›</Text>}
              {duration > 0 && <Text style={s.time}>{timeLabel(duration)}</Text>}
            </View>
          </Pressable>
          <View style={s.controls}>
            <Button
              label="Previous"
              icon="previous"
              iconOnly
              disabled={!playback.previous}
              onPress={() => transport(audio.skip(-1))}
            />
            <Button
              label={playback.playing ? 'Pause' : 'Play'}
              icon={playback.playing ? 'pause' : 'play'}
              primary
              nextFocusDown={firstSong}
              iconOnly
              preferred
              onPress={() => transport(audio.toggle())}
            />
            <Button
              label="Next"
              icon="next"
              iconOnly
              disabled={!playback.next}
              onPress={() => transport(audio.skip(1))}
            />
          </View>
          {!!(playback.message || error) && (
            <Text accessibilityLiveRegion="polite" style={s.notice}>
              {playback.message || error}
            </Text>
          )}
        </View>
      </View>
      <View style={s.upcoming}>
        <Text style={s.queueHeading}>Up next</Text>
        {playback.upNext.length ? (
          <FlatList
            horizontal
            style={s.queueList}
            data={playback.upNext}
            showsHorizontalScrollIndicator={false}
            removeClippedSubviews={false}
            initialNumToRender={8}
            onViewableItemsChanged={onViewableItemsChanged}
            keyExtractor={(song, index) => index + ':' + song.id}
            renderItem={({ item, index }) => (
              <UpcomingSong
                session={session}
                collectionId={collectionId}
                loadArt={visibleSongs.includes(index)}
                song={item}
                index={index}
                firstRef={index === 0 ? firstRef : undefined}
                width={Math.round(Math.min(width * 0.26, 290))}
                onPlay={() => {
                  if (playback.id) transport(audio.playUpcoming(playback.id, item.id));
                }}
              />
            )}
          />
        ) : (
          <Text style={s.songArtist}>End of queue</Text>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1 },
  upcoming: { borderTopColor: color.border, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 9, gap: 5 },
  queueList: { height: 66, flexGrow: 0 },
  queueHeading: { color: color.ink, fontSize: 19, fontWeight: '700', letterSpacing: -0.3 },
  song: {
    flexDirection: 'row',
    gap: 9,
    alignItems: 'center',
    padding: 5,
    marginRight: 8,
    height: 66,
    borderColor: 'transparent',
    borderWidth: 2,
    borderRadius: 9,
  },
  focusedSong: { backgroundColor: color.surface, borderColor: color.lime },
  upcomingNumber: {
    color: color.muted,
    fontSize: 18,
    width: 30,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  songText: { flex: 1 },
  songTitle: { fontSize: 16, color: color.ink, fontWeight: '600' },
  songArtist: { fontSize: 14, color: color.muted },
  columns: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 38 },
  copy: { flex: 1 },
  kicker: { color: color.lime, fontSize: 12, fontWeight: '700', letterSpacing: 2.1, marginBottom: 8 },
  title: { fontSize: 40, lineHeight: 44, fontWeight: '800', letterSpacing: -1.35, color: color.ink },
  artist: { fontSize: 22, marginTop: 5, fontWeight: '600', color: color.secondary },
  collection: { color: color.muted, fontSize: 16, marginTop: 3 },
  progress: { marginTop: 13, gap: 5, padding: 6, borderWidth: 2, borderColor: 'transparent', borderRadius: 8 },
  seekFocused: { borderColor: color.lime, backgroundColor: color.surface },
  seekHint: { color: color.ink, fontSize: 13, fontWeight: '600' },
  rail: { height: 4, borderRadius: 2, backgroundColor: color.border, overflow: 'hidden' },
  fill: { height: 4, backgroundColor: color.lime },
  times: { flexDirection: 'row', justifyContent: 'space-between' },
  time: { color: color.muted, fontSize: 13, fontVariant: ['tabular-nums'] },
  controls: { flexDirection: 'row', gap: 10, marginTop: 10, alignItems: 'center' },
  notice: { color: color.error, fontSize: 15, marginTop: 9 },
});
