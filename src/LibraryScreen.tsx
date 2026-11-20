import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import type { Collection, Track } from './api';
import type { Connection } from './connection';
import { Artwork, color, Icon, timeLabel } from './TvControls';

function CollectionCard({
  session,
  item,
  size,
  preferred,
  onOpen,
}: {
  session: Connection;
  item: Collection;
  size: number;
  preferred: boolean;
  onOpen: (item: Collection) => void;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={item.name + ', ' + item.kind}
      hasTVPreferredFocus={preferred}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={() => onOpen(item)}
      style={{ width: size + 18 }}
    >
      <View style={[s.frame, focused && s.frameFocused]}>
        <Artwork session={session} id={item.id} flow={item.kind === 'Flow'} size={size} />
      </View>
      <Text numberOfLines={1} style={[s.cardName, focused && s.cardFocusText]}>
        {item.name}
      </Text>
    </Pressable>
  );
}

function Shelf({
  title,
  items,
  size,
  preferredId,
  session,
  onOpen,
}: {
  title: string;
  items: Collection[];
  size: number;
  preferredId?: string;
  session: Connection;
  onOpen: (item: Collection) => void;
}) {
  if (!items.length) return null;
  const index = items.findIndex((item) => item.id === preferredId);
  const width = size + 18;
  return (
    <View style={s.shelf}>
      <View style={s.shelfHeading}>
        <Text accessibilityRole="header" style={s.heading}>
          {title}
        </Text>
        <Text style={s.shelfCount}>{items.length.toLocaleString()}</Text>
      </View>
      <FlatList
        horizontal
        style={{ height: size + 36, flexGrow: 0 }}
        data={items}
        keyExtractor={(item) => item.id}
        showsHorizontalScrollIndicator={false}
        initialScrollIndex={index > 0 ? index : undefined}
        initialNumToRender={5}
        maxToRenderPerBatch={4}
        windowSize={3}
        getItemLayout={(_, i) => ({ index: i, length: width, offset: i * width })}
        renderItem={({ item }) => (
          <CollectionCard
            session={session}
            item={item}
            size={size}
            preferred={item.id === preferredId}
            onOpen={onOpen}
          />
        )}
      />
    </View>
  );
}

export function Library({
  session,
  items,
  last,
  onOpen,
}: {
  session: Connection;
  items: Collection[];
  last: Collection | null;
  onOpen: (item: Collection) => void;
}) {
  const { width, height } = useWindowDimensions();
  const playlists = useMemo(() => items.filter((item) => item.kind === 'Playlist'), [items]);
  const flows = useMemo(() => items.filter((item) => item.kind === 'Flow'), [items]);
  const first = (last && items.find((item) => item.kind === last.kind && item.id === last.id)) || items[0];
  if (!first)
    return (
      <View style={s.empty}>
        <Text style={s.heading}>No playlists or Flows yet</Text>
        <Text style={s.secondary}>Save a playlist or create a Flow in Aurral to see it here.</Text>
      </View>
    );
  // Leave the next artwork peeking in at the edge when a shelf overflows.
  const shelfHeight = playlists.length && flows.length ? Math.max(70, (height - 250) / 2) : height * 0.32;
  const cardSize = Math.round(Math.min(width * 0.166, shelfHeight, 210));
  return (
    <ScrollView style={s.library} contentContainerStyle={s.homeShelves} showsVerticalScrollIndicator={false}>
      <Shelf title="Playlists" items={playlists} size={cardSize} session={session}
        preferredId={first.kind === 'Playlist' ? first.id : undefined} onOpen={onOpen} />
      <Shelf title="Flows" items={flows} size={cardSize} session={session}
        preferredId={first.kind === 'Flow' ? first.id : undefined} onOpen={onOpen} />
    </ScrollView>
  );
}

const rowHeight = 60;
function TrackRow({
  track,
  index,
  current,
  preferred,
  onPlay,
}: {
  track: Track;
  index: number;
  current: boolean;
  preferred: boolean;
  onPlay: (index: number) => void;
}) {
  const [focus, setFocus] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={track.title + ', ' + track.artist}
      hasTVPreferredFocus={preferred}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      style={[s.track, focus && s.trackFocus]}
      onPress={() => onPlay(index)}
    >
      <View style={s.number}>
        {current || focus ? (
          <Icon name={focus ? 'play' : 'sound'} tint={focus ? color.ink : color.lime} size={19} />
        ) : (
          <Text style={s.trackMeta}>{index + 1}</Text>
        )}
      </View>
      <View style={s.trackCopy}>
        <Text numberOfLines={1} style={[s.trackTitle, current && s.current]}>
          {track.title}
        </Text>
        <Text numberOfLines={1} style={s.trackMeta}>
          {track.artist}
        </Text>
      </View>
      {track.durationMs != null && <Text style={s.trackMeta}>{timeLabel(track.durationMs)}</Text>}
    </Pressable>
  );
}

export function CollectionDetails({
  session,
  collection,
  tracks,
  cursor,
  playingId,
  onPlay,
}: {
  session: Connection;
  collection: Collection;
  tracks: Track[];
  cursor: string;
  playingId: string | null;
  onPlay: (index: number) => void;
}) {
  const { width, height } = useWindowDimensions();
  const size = Math.round(Math.min(width * 0.3, height * 0.49, 360));
  const initial = Math.max(
    0,
    tracks.findIndex((track) => track.id === cursor),
  );
  return (
    <View style={s.columns}>
      <View style={[s.spotlight, { width: size + 10 }]}>
        <Artwork session={session} id={collection.id} flow={collection.kind === 'Flow'} size={size} />
        <Text style={s.kind}>{collection.kind.toUpperCase()}</Text>
        <Text numberOfLines={2} style={s.heroTitle}>
          {collection.name}
        </Text>
        {!!collection.description && (
          <Text numberOfLines={2} style={s.secondary}>
            {collection.description}
          </Text>
        )}
      </View>
      <View style={s.detailList}>
        <View style={s.shelfHeading}>
          <Text style={s.heading}>Tracks</Text>
          <Text style={s.shelfCount}>{tracks.length.toLocaleString()}</Text>
        </View>
        <FlatList
          data={tracks}
          keyExtractor={(t) => t.id}
          initialNumToRender={9}
          windowSize={5}
          getItemLayout={(_, index) => ({ index, offset: rowHeight * index, length: rowHeight })}
          initialScrollIndex={initial > 0 ? initial : undefined}
          ListEmptyComponent={<Text style={s.secondary}>No downloaded tracks to play.</Text>}
          renderItem={({ item, index }) => (
            <TrackRow
              track={item}
              index={index}
              current={item.id === playingId}
              preferred={initial === index}
              onPlay={onPlay}
            />
          )}
        />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  columns: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 36, minHeight: 0 },
  spotlight: { justifyContent: 'center', gap: 6 },
  heroTitle: { color: color.ink, fontSize: 30, lineHeight: 33, fontWeight: '800', letterSpacing: -1 },
  kind: { color: color.lime, fontWeight: '700', letterSpacing: 1.8, fontSize: 11, marginTop: 7 },
  secondary: { fontSize: 16, color: color.secondary, lineHeight: 21 },
  library: { flex: 1 },
  homeShelves: { gap: 16, paddingTop: 14, paddingBottom: 18 },
  shelf: { gap: 5 },
  shelfHeading: { flexDirection: 'row', alignItems: 'baseline', gap: 9, paddingLeft: 4 },
  heading: { color: color.ink, fontSize: 24, lineHeight: 30, letterSpacing: -0.7, fontWeight: '700' },
  shelfCount: { color: color.muted, fontSize: 14, fontWeight: '600' },
  frame: { alignSelf: 'flex-start', borderWidth: 2, borderColor: 'transparent', padding: 2, borderRadius: 6 },
  frameFocused: { borderColor: color.lime },
  cardName: {
    color: color.secondary,
    marginTop: 2,
    paddingLeft: 4,
    paddingRight: 10,
    fontWeight: '600',
    fontSize: 15,
  },
  cardFocusText: { color: color.ink },
  detailList: { flex: 1, alignSelf: 'stretch', paddingTop: 12, gap: 9 },
  track: {
    height: rowHeight,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 12,
    borderWidth: 2,
    borderRadius: 9,
    borderColor: 'transparent',
  },
  trackFocus: { backgroundColor: color.surface, borderColor: color.lime },
  number: { width: 25, alignItems: 'center' },
  trackCopy: { flex: 1 },
  trackTitle: { color: color.ink, fontSize: 17, fontWeight: '600' },
  trackMeta: { color: color.muted, fontSize: 14, fontVariant: ['tabular-nums'] },
  current: { color: color.lime },
  empty: { flex: 1, gap: 8, justifyContent: 'center' },
});
