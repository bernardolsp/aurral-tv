import { useEffect, useRef, useState, type RefObject } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { ExpiredSession } from './api';
import type { Connection } from './connection';
import { libraryGenres, type LibraryGenre } from './libraryFilters';
import { libraryPage, type LibraryAlbum, type LibraryArtist, type LibraryKind, type LibraryTrack } from './musicLibrary';
import { Button, color } from './TvControls';
import { itemKey, LibraryResults, type LibraryItem } from './MusicLibraryRows';

type Props = {
  kind: 'genres' | 'favorites'; session: Connection; revision: number; active: boolean;
  onArtist: (artist: LibraryArtist) => void; onAlbum: (album: LibraryAlbum) => void; onSong: (tracks: LibraryTrack[], index: number, label: string) => void;
  backRef: RefObject<(() => boolean) | null>; onExpired: () => void;
};
type Results = { genres: LibraryGenre[] } | { items: LibraryItem[]; hasMore: boolean };
const labels: Record<LibraryKind, string> = { artists: 'Artists', albums: 'Albums', tracks: 'Songs' };
const rowHeight = 62;
const count = (n: number, noun: string) => n + ' ' + noun + (n === 1 ? '' : 's');

export function LibraryFiltersScreen(props: Props) {
  return <FilterBrowser key={props.kind} {...props} />;
}

function FilterBrowser({kind,session,active,revision,onArtist,onAlbum,onSong,onExpired,backRef}: Props) {
  const [genre, setGenre] = useState<string | null>(null);
  const [category, setCategory] = useState<LibraryKind>('tracks');
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [results, setResults] = useState<Results | null>(null);
  const [error, setError] = useState('');
  const [viewport, setViewport] = useState({width: 0, height: 0});
  const preferred = useRef('');
  const expired = useRef(onExpired);
  expired.current = onExpired;
  useEffect(() => {
    if (!active) return;
    const back = () => {
      if (!genre) return false;
      preferred.current = genre;
      setGenre(null); setPage(1);
      return true;
    };
    backRef.current = back;
    return () => { if (backRef.current === back) backRef.current = null; };
  }, [active, backRef, genre]);
  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    async function read(): Promise<Results> {
      if (kind === 'genres' && genre === null) {
        const items = await libraryGenres(session, signal);
        return { genres: items };
      }
      const data = await libraryPage(session, {
        kind: category, page, genre: genre ?? undefined, favorite: kind === 'favorites', signal,
      });
      let items: LibraryItem[];
      switch (category) {
        case 'artists': items = data.artists.map(data => ({ kind: 'artist', data })); break;
        case 'albums': items = data.albums.map(data => ({ kind: 'album', data })); break;
        case 'tracks': items = data.tracks.map(data => ({ kind: 'track', data })); break;
      }
      return { items, hasMore: data.hasMore };
    }
    setResults(null); setError('');
    void read().then(next => { if (!signal.aborted) setResults(next); }).catch(e => {
      if (signal.aborted) return;
      if (e instanceof ExpiredSession) expired.current();
      else setError(e instanceof Error ? e.message : 'Could not load the library.');
    });
    return () => controller.abort();
  }, [session, kind, genre, category, page, revision, reload]);

  function open(item: LibraryItem) {
    preferred.current = itemKey(item);
    if (item.kind === 'artist') onArtist(item.data);
    else if (item.kind === 'album') onAlbum(item.data);
    else if (results && 'items' in results) {
      const songs = results.items.flatMap(entry => entry.kind === 'track' ? [entry.data] : []);
      const index = songs.indexOf(item.data);
      if (index >= 0) onSong(songs, index, genre ?? 'Favorites');
    }
  }
  const title = genre ?? (kind === 'genres' ? 'Genres' : 'Favorites');
  const tabs: LibraryKind[] = kind === 'favorites' ? ['artists', 'albums', 'tracks'] : genre ? ['albums', 'tracks'] : [];
  const genres = results && 'genres' in results ? results.genres : null;
  const initial = Math.max(0, genres?.findIndex(row => row.name === preferred.current) ?? 0);
  return (
    <View style={s.screen}>
      <View style={s.toolbar}>
        <Text accessibilityRole="header" style={s.heading} numberOfLines={1}>{title}</Text>
        {tabs.map(tab => (
          <Button key={tab} label={labels[tab]} primary={tab === category} onPress={() => {
            if (category !== tab) { preferred.current = ''; setPage(1); setCategory(tab); }
          }} />
        ))}
      </View>
      {error ? <View style={s.message}>
        <Text style={s.error} accessibilityLiveRegion="polite">{error}</Text>
        <Button label="Try again" icon="refresh" onPress={() => setReload(value => value + 1)} />
      </View> : !results ? <ActivityIndicator accessibilityLabel={'Loading ' + title} color={color.lime} /> : <>
        {genres ? <View style={s.items} onLayout={({nativeEvent:{layout:{width,height}}}) => setViewport(old =>
          width === old.width && height === old.height ? old : {width,height})}>
          {!genres.length
            ? <Text style={s.muted}>No genres in your library.</Text>
            : viewport.height > 0 && viewport.width > 0 && <FlatList
              style={viewport} data={genres} keyExtractor={item => item.name} initialScrollIndex={initial || undefined}
              initialNumToRender={9} windowSize={4}
              getItemLayout={(_, index) => ({ index, length: rowHeight, offset: rowHeight * index })}
              renderItem={({item}) => <GenreRow genre={item} preferred={active && preferred.current === item.name}
                onSelect={() => {
                  preferred.current = '';
                  setCategory(item.albums === 0 && item.tracks > 0 ? 'tracks' : 'albums');
                  setGenre(item.name);
                  setPage(1);
                }} />}
            />}
        </View> : 'items' in results && (results.items.length ?
          <LibraryResults key={page + ':' + category + ':' + (genre ?? '')} items={results.items} session={session}
            layout={category === 'tracks' ? 'songs' : 'grid'} onOpen={open}
            initialKey={preferred.current} active={active} />
          : <Text style={s.muted}>{genre ? 'No available ' + labels[category].toLowerCase() + ' in this genre.' :
            'No favorite ' + labels[category].toLowerCase() + ' in your library.'}</Text>)}
        {'hasMore' in results && (page > 1 || results.hasMore) && <View style={s.pages}>
          <Button label="Previous page" disabled={page === 1} onPress={() => { preferred.current = ''; setPage(n => n - 1); }} />
          <Text style={s.muted}>Page {page}</Text>
          <Button label="Next page" disabled={!results.hasMore} onPress={() => { preferred.current = ''; setPage(n => n + 1); }} />
        </View>}
      </>}
    </View>
  );
}

function GenreRow({genre,preferred,onSelect}: { genre: LibraryGenre; preferred: boolean; onSelect: () => void }) {
  const [focused,setFocused] = useState(false);
  return <Pressable accessibilityRole="button" accessibilityLabel={genre.name}
    hasTVPreferredFocus={preferred} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onPress={onSelect}
    style={[s.row, focused && s.focus]}>
    <Text style={s.title} numberOfLines={1}>{genre.name}</Text>
    <Text style={s.muted}>{count(genre.albums, 'album')} · {count(genre.tracks, 'song')}</Text>
  </Pressable>;
}

const s = StyleSheet.create({
  screen: { flex: 1, minWidth: 0, gap: 8 },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 45 },
  heading: { flex: 1, color: color.ink, fontSize: 25, fontWeight: '700', letterSpacing: -0.6 },
  items: { flex: 1, minHeight: 0 }, pages: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  row: { width: '100%', height: rowHeight, paddingHorizontal: 10, gap: 12, flexDirection: 'row', alignItems: 'center',
    borderRadius: 6, borderWidth: 2, borderColor: 'transparent' },
  focus: { backgroundColor: color.raised, borderColor: color.lime },
  title: { flex: 1, fontSize: 17, fontWeight: '600', color: color.ink }, muted: { fontSize: 14, color: color.secondary },
  error: { color: color.error, fontSize: 15 },
  message: { alignItems: 'flex-start', gap: 10 },
});
