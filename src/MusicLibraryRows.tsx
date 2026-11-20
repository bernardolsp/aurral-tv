import React, { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Connection } from './connection';
import type { LibraryAlbum, LibraryArtist, LibraryTrack } from './musicLibrary';
import { Artwork, Icon, color, timeLabel } from './TvControls';

export type LibraryItem =
  | { kind: 'artist'; data: LibraryArtist }
  | { kind: 'album'; data: LibraryAlbum }
  | { kind: 'track'; data: LibraryTrack };

export const itemKey = (item: LibraryItem) => item.kind + ':' + item.data.id;
export const titleOf = (item: LibraryItem) => (item.kind === 'artist' ? item.data.name : item.data.title);
const noun = (n: number, single: string) => (n === 1 ? single : single + 's');

export function EntityArtwork({
  session,
  item,
  size,
}: {
  session: Connection;
  item: LibraryItem;
  size: number;
}) {
  const circular = item.kind === 'artist';
  return (
    <View style={{ width: size, height: size, borderRadius: circular ? size / 2 : 5, overflow: 'hidden' }}>
      <Artwork
        session={session}
        size={size}
        id={item.data.id}
        entityArtworkPath={item.data.artworkPath}
        artworkFallbackLabel={titleOf(item)}
      />
    </View>
  );
}

function LibraryTile({
  session,
  item,
  width,
  preferred,
  onOpen,
}: {
  session: Connection;
  item: LibraryItem;
  width: number;
  preferred: boolean;
  onOpen: (item: LibraryItem) => void;
}) {
  const [focus, setFocus] = useState(false);
  const subtitle =
    item.kind === 'artist'
      ? item.data.albumCount + ' ' + noun(item.data.albumCount, 'album')
      : item.data.artist;
  const portrait = item.kind === 'artist';
  const size = Math.max(1, width - 16);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={titleOf(item) + ', ' + subtitle}
      hasTVPreferredFocus={preferred}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      onPress={() => onOpen(item)}
      style={{ width, paddingRight: 8 }}
    >
      <View style={[s.artFrame, { borderRadius: portrait ? size : 8 }, focus && s.artFocus]}>
        <EntityArtwork session={session} item={item} size={size} />
      </View>
      <Text numberOfLines={1} style={[s.tileName, portrait && s.center, focus && s.focusText]}>
        {titleOf(item)}
      </Text>
      <Text numberOfLines={1} style={[s.subtitle, portrait && s.center]}>
        {subtitle}
      </Text>
    </Pressable>
  );
}

function SongRow({
  session,
  track,
  album,
  preferred,
  onOpen,
}: {
  session: Connection;
  track: LibraryTrack;
  album: boolean;
  preferred: boolean;
  onOpen: (item: LibraryItem) => void;
}) {
  const [focus, setFocus] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={track.title + ', ' + track.artist}
      hasTVPreferredFocus={preferred}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      onPress={() => onOpen({ kind: 'track', data: track })}
      style={[s.song, focus && s.songFocused]}
    >
      {album ? (
        <Text style={s.ordinal}>{track.trackNumber > 0 ? track.trackNumber : '♪'}</Text>
      ) : (
        <EntityArtwork session={session} item={{ kind: 'track', data: track }} size={35} />
      )}
      <View style={s.songCopy}>
        <Text numberOfLines={1} style={s.songTitle}>
          {track.title}
        </Text>
        <Text numberOfLines={1} style={s.subtitle}>
          {album ? track.artist : [track.artist, track.albumName].filter(Boolean).join(' · ')}
        </Text>
      </View>
      {track.durationMs != null && <Text style={s.subtitle}>{timeLabel(track.durationMs)}</Text>}
      {focus && <Icon name="next" size={13} />}
    </Pressable>
  );
}

/**
 * React Native TV wraps FlatList in a native focus guide. Give its viewport
 * both measured dimensions, so rows keep their width and screen-reader bounds.
 */
export function LibraryResults({
  session,
  items,
  layout,
  active,
  initialKey,
  onOpen,
}: {
  session: Connection;
  items: LibraryItem[];
  layout: 'grid' | 'songs' | 'album';
  active: boolean;
  initialKey?: string;
  onOpen: (item: LibraryItem) => void;
}) {
  const [space, setSpace] = useState({ width: 0, height: 0 });
  const columns = layout === 'grid' ? Math.max(2, Math.min(6, Math.floor(space.width / 142))) : 1;
  const tileWidth = Math.floor(space.width / columns);
  const rowHeight = layout === 'grid' ? tileWidth + 40 : 52;
  const first = items.findIndex((item) => itemKey(item) === initialKey);
  return (
    <View
      style={s.viewport}
      onLayout={({
        nativeEvent: {
          layout: { width, height },
        },
      }) => {
        if (width > 0 && height > 0)
          setSpace((old) => (old.width === width && old.height === height ? old : { width, height }));
      }}
    >
      {space.width > 0 && space.height > 0 && (
        <FlatList
          key={layout + columns}
          data={items}
          numColumns={columns}
          keyExtractor={itemKey}
          style={{ width: space.width, height: space.height }}
          showsVerticalScrollIndicator={false}
          initialNumToRender={columns * 5}
          maxToRenderPerBatch={columns * 3}
          windowSize={5}
          initialScrollIndex={first > 0 ? Math.floor(first / columns) : undefined}
          getItemLayout={(_, index) => ({ length: rowHeight, offset: index * rowHeight, index })}
          renderItem={({ item }) => {
            const preferred = active && initialKey === itemKey(item);
            if (item.kind === 'track')
              return (
                <SongRow
                  session={session}
                  track={item.data}
                  album={layout === 'album'}
                  preferred={preferred}
                  onOpen={onOpen}
                />
              );
            return (
              <View style={{ height: rowHeight }}>
                <LibraryTile
                  session={session}
                  item={item}
                  width={tileWidth}
                  preferred={preferred}
                  onOpen={onOpen}
                />
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  viewport: { flex: 1, minHeight: 0, minWidth: 0 },
  artFrame: { alignSelf: 'flex-start', padding: 2, borderWidth: 2, borderColor: 'transparent' },
  artFocus: { borderColor: color.lime },
  tileName: { color: color.ink, fontSize: 16, fontWeight: '600', marginTop: 5, marginHorizontal: 2 },
  center: { textAlign: 'center' },
  subtitle: { color: color.muted, fontSize: 14 },
  focusText: { color: '#fff' },
  song: {
    height: 52,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingHorizontal: 8,
    borderWidth: 2,
    borderColor: 'transparent',
    borderRadius: 6,
  },
  songFocused: { borderColor: color.lime, backgroundColor: color.surface },
  songTitle: { fontSize: 17, fontWeight: '600', color: color.ink },
  songCopy: { flex: 1, gap: 1, minWidth: 0 },
  ordinal: { width: 28, textAlign: 'center', color: color.muted, fontSize: 15, fontVariant: ['tabular-nums'] },
});
