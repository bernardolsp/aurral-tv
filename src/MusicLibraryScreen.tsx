import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { ExpiredSession, type Track } from './api';
import type { Connection } from './connection';
import {
  albumTracks,
  libraryPage,
  searchMusicLibrary,
  playbackDestination,
  type PlaybackLink,
  type PlaybackDestination,
  type LibraryAlbum,
  type LibraryArtist,
  type LibraryKind,
  type LibraryTrack,
} from './musicLibrary';
import { LibraryFiltersScreen } from './LibraryFiltersScreen';
import { EntityArtwork, itemKey, LibraryResults, titleOf, type LibraryItem } from './MusicLibraryRows';
import { Button, color, timeLabel } from './TvControls';

type Section = LibraryKind | 'search' | 'genres' | 'favorites';
type Route =
  | { type: 'artist'; artist: LibraryArtist }
  | { type: 'album'; album: LibraryAlbum }
  | { type: 'song'; tracks: LibraryTrack[]; index: number; source: string }
  | { type: 'results'; kind: LibraryKind; query: string };
type Props = {
  session: Connection;
  active: boolean;
  revision: number;
  canQueue: boolean;
  backRef: React.RefObject<(() => boolean) | null>;
  onPlay: (tracks: Track[], index: number, label: string) => Promise<void>;
  onEnqueue: (tracks: Track[], placement: 'next' | 'end') => Promise<void>;
  onExpired: () => void;
};
type Shared = Pick<Props, 'session' | 'active' | 'revision' | 'onExpired'>;
const names: Record<Section, string> = {
  artists: 'Artists',
  albums: 'Albums',
  tracks: 'Songs',
  genres: 'Genres',
  favorites: 'Favorites',
  search: 'Search',
};
const sections: Section[] = ['artists', 'albums', 'tracks', 'genres', 'favorites', 'search'];
const categories: LibraryKind[] = ['artists', 'albums', 'tracks'];
const errorText = (error: unknown) => (error instanceof Error ? error.message : 'Could not load your library.');

function useRead<T>(read: (signal: AbortSignal) => Promise<T>, revision: number, onExpired: () => void) {
  const [state, setState] = useState<{ result?: T; error?: string; request: typeof read; revision: number }>();
  const [retry, setRetry] = useState(0);
  const expire = useRef(onExpired);
  expire.current = onExpired;
  useEffect(() => {
    const request = new AbortController();
    void read(request.signal)
      .then((result) => {
        if (!request.signal.aborted) setState({ result, request: read, revision });
      })
      .catch((error) => {
        if (request.signal.aborted) return;
        if (error instanceof ExpiredSession) expire.current();
        else setState({ error: errorText(error), request: read, revision });
      });
    return () => request.abort();
  }, [read, revision, retry]);
  const current = state?.request === read && state.revision === revision ? state : undefined;
  return {
    ...current,
    retry: () => {
      setState(undefined);
      setRetry((n) => n + 1);
    },
  };
}

function Notice({ error, retry, empty }: { error?: string; retry?: () => void; empty?: string }) {
  return (
    <View style={s.notice}>
      {error || empty ? (
        <Text accessibilityLiveRegion="polite" style={error ? s.error : s.muted}>
          {error || empty}
        </Text>
      ) : (
        <ActivityIndicator color={color.lime} accessibilityLabel="Loading library" />
      )}
      {error && retry && <Button icon="refresh" label="Try again" onPress={retry} />}
    </View>
  );
}

function NavItem({
  name,
  selected,
  active,
  onPress,
}: {
  name: string;
  selected: boolean;
  active: boolean;
  onPress: () => void;
}) {
  const [focus, setFocus] = useState(false);
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      hasTVPreferredFocus={selected && active}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      onPress={onPress}
      style={[s.navItem, selected && s.navSelected, focus && s.focus]}
    >
      <Text style={[s.navTitle, selected && s.navCurrent]}>{name}</Text>
    </Pressable>
  );
}

function asItems(
  kind: LibraryKind,
  page: { artists: LibraryArtist[]; albums: LibraryAlbum[]; tracks: LibraryTrack[] },
): LibraryItem[] {
  if (kind === 'artists') return page.artists.map((data) => ({ kind: 'artist', data }));
  if (kind === 'albums') return page.albums.map((data) => ({ kind: 'album', data }));
  return page.tracks.map((data) => ({ kind: 'track', data }));
}

function Browse({
  session,
  active,
  revision,
  onExpired,
  kind,
  artistId,
  query,
  onOpen,
  returning = true,
}: Shared & {
  kind: LibraryKind;
  artistId?: string;
  query?: string;
  returning?: boolean;
  onOpen: (item: LibraryItem) => void;
}) {
  const [page, setPage] = useState(1);
  const [last, setLast] = useState<string>();
  const read = useCallback(
    (signal: AbortSignal) => libraryPage(session, { kind, page, query, artistId, signal }),
    [session, kind, page, query, artistId],
  );
  const { result, error, retry } = useRead(read, revision, onExpired);
  const items = result ? asItems(kind, result) : [];
  const title = artistId ? 'Discography' : names[kind];
  const changePage = (n: number) => {
    setLast(undefined);
    setPage(n);
  };
  return (
    <View style={s.content}>
      <View style={s.headingRow}>
        <View style={s.headerCopy}>
          <Text numberOfLines={1} accessibilityRole="header" style={s.heading}>
            {title}
          </Text>
          {query && (
            <Text numberOfLines={1} style={s.muted}>
              {'Results for “' + query + '”'}
            </Text>
          )}
        </View>
        {!!result && <Text style={s.muted}>{result.total.toLocaleString()}</Text>}
      </View>
      {result && items.length ? (
        <LibraryResults
          key={page}
          session={session}
          items={items}
          layout={kind === 'tracks' ? 'songs' : 'grid'}
          active={active}
          initialKey={last ?? (returning ? itemKey(items[0]) : undefined)}
          onOpen={(item) => {
            setLast(itemKey(item));
            onOpen(item);
          }}
        />
      ) : (
        <Notice
          error={error}
          retry={retry}
          empty={
            result
              ? query
                ? 'No matches on this page.'
                : artistId
                  ? 'There are no available albums for this artist.'
                  : 'There are no available ' + names[kind].toLowerCase() + ' on this page.'
              : undefined
          }
        />
      )}
      {(page > 1 || result?.hasMore) && (
        <View style={s.pager}>
          <Button
            icon="back"
            label="Previous page"
            disabled={page === 1 || !result}
            onPress={() => changePage(page - 1)}
          />
          <Text style={s.muted}>Page {page}</Text>
          <Button label="Next page" disabled={!result?.hasMore} onPress={() => changePage(page + 1)} />
        </View>
      )}
    </View>
  );
}

function Search({
  active,
  session,
  revision,
  onExpired,
  onOpen,
  onMore,
}: Shared & {
  onOpen: (item: LibraryItem) => void;
  onMore: (kind: LibraryKind, query: string) => void;
}) {
  const [lastFocus, setLastFocus] = useState<string>();
  const [entry, setEntry] = useState('');
  const [query, setQuery] = useState('');
  const [focus, setFocus] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(entry.trim()), 350);
    return () => clearTimeout(timer);
  }, [entry]);
  const read = useCallback(
    (signal: AbortSignal) => searchMusicLibrary(session, query, signal),
    [session, query],
  );
  const { result, error, retry } = useRead(read, revision, onExpired);
  const showResults = !!query && entry.trim() === query;
  return (
    <View style={s.content}>
      <Text accessibilityRole="header" style={s.heading}>
        Search library
      </Text>
      <TextInput
        accessibilityLabel="Search your library"
        placeholder="Artists, albums, or songs"
        value={entry}
        maxLength={180}
        placeholderTextColor={color.muted}
        onChangeText={(value) => {
          setLastFocus(undefined);
          setEntry(value);
        }}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        onSubmitEditing={() => {
          setQuery(entry.trim());
          Keyboard.dismiss();
        }}
        autoCorrect={false}
        returnKeyType="search"
        style={[s.input, focus && s.focus]}
      />
      {showResults &&
        (result ? (
          <ScrollView keyboardShouldPersistTaps="handled">
            {!categories.some((kind) => result[kind].length > 0) && (
              <Text style={s.muted}>No matches in your library.</Text>
            )}
            {categories.map((kind) => {
              const items = asItems(kind, result);
              if (!items.length) return null;
              return (
                <View key={kind} style={s.searchGroup}>
                  <View style={s.headingRow}>
                    <Text accessibilityRole="header" style={s.sectionHeading}>
                      {names[kind]}
                    </Text>
                    {items.length > 4 && (
                      <Button
                        label={'All ' + names[kind].toLowerCase()}
                        preferred={active && lastFocus === kind}
                        onPress={() => {
                          setLastFocus(kind);
                          onMore(kind, query);
                        }}
                      />
                    )}
                  </View>
                  {items.slice(0, 4).map((item) => (
                    <SearchRow
                      key={itemKey(item)}
                      session={session}
                      item={item}
                      preferred={active && lastFocus === itemKey(item)}
                      onOpen={() => {
                        setLastFocus(itemKey(item));
                        onOpen(item);
                      }}
                    />
                  ))}
                </View>
              );
            })}
          </ScrollView>
        ) : (
          <Notice error={error} retry={retry} />
        ))}
    </View>
  );
}
function SearchRow({
  session,
  item,
  preferred,
  onOpen,
}: {
  session: Connection;
  item: LibraryItem;
  preferred: boolean;
  onOpen: () => void;
}) {
  const [focus, setFocus] = useState(false);
  return (
    <Pressable
      onPress={onOpen}
      hasTVPreferredFocus={preferred}
      accessibilityRole="button"
      accessibilityLabel={titleOf(item)}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      style={[s.hit, focus && s.focus]}
    >
      <EntityArtwork session={session} item={item} size={32} />
      <Text numberOfLines={1} style={s.hitTitle}>
        {titleOf(item)}
      </Text>
      {item.kind !== 'artist' && (
        <Text numberOfLines={1} style={s.hitArtist}>
          {item.data.artist}
        </Text>
      )}
    </Pressable>
  );
}

function Hero({
  session,
  item,
  children,
}: {
  session: Connection;
  item: LibraryItem;
  children?: React.ReactNode;
}) {
  const { width, height } = useWindowDimensions();
  const size = Math.round(Math.min(width * 0.22, height * 0.35, 245));
  return (
    <View style={[s.hero, { width: Math.round(width * 0.28) }]}>
      <EntityArtwork session={session} item={item} size={size} />
      <Text numberOfLines={2} accessibilityRole="header" style={s.heroTitle}>
        {titleOf(item)}
      </Text>
      {item.kind !== 'artist' && (
        <Text numberOfLines={1} style={s.artist}>
          {item.data.artist}
        </Text>
      )}
      {item.kind === 'album' && !!item.data.year && <Text style={s.muted}>{item.data.year}</Text>}
      {children}
    </View>
  );
}

function Actions({
  tracks,
  index,
  label,
  entity,
  active,
  canQueue,
  onPlay,
  onEnqueue,
  onExpired,
}: Pick<Props, 'active' | 'canQueue' | 'onPlay' | 'onEnqueue' | 'onExpired'> & {
  tracks: LibraryTrack[];
  index: number;
  label: string;
  entity: 'song' | 'album';
}) {
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const run = async (action: 'play' | 'next' | 'end') => {
    if (lock.current || !tracks.length) return;
    lock.current = true;
    setBusy(true);
    setStatus('');
    try {
      if (action === 'play') await onPlay(tracks, index, label);
      else {
        await onEnqueue(entity === 'song' ? [tracks[index]] : tracks, action);
        setStatus(action === 'next' ? 'Playing next' : 'Added to queue');
      }
    } catch (e) {
      if (e instanceof ExpiredSession) onExpired();
      else setStatus(errorText(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const disabled = busy || !tracks.length;
  return (
    <View style={s.actions}>
      <Button
        label={entity === 'album' ? 'Play album' : 'Play now'}
        icon="play"
        primary
        preferred={active}
        disabled={disabled}
        onPress={() => void run('play')}
      />
      {canQueue && (
        <>
          <Button label="Play next" icon="next" disabled={disabled} onPress={() => void run('next')} />
          <Button label="Add to queue" icon="queue" disabled={disabled} onPress={() => void run('end')} />
        </>
      )}
      {!!status && (
        <Text accessibilityLiveRegion="polite" style={s.feedback}>
          {status}
        </Text>
      )}
    </View>
  );
}

type OpenSong = (tracks: LibraryTrack[], index: number, source: string) => void;
function AlbumScreen({
  album,
  onSong,
  ...props
}: Shared & Pick<Props, 'onPlay' | 'onEnqueue' | 'canQueue'> & { album: LibraryAlbum; onSong: OpenSong }) {
  const read = useCallback(
    (signal: AbortSignal) => albumTracks(props.session, album.id, signal),
    [props.session, album.id],
  );
  const { result, error, retry } = useRead(read, props.revision, props.onExpired);
  const [selected, setSelected] = useState<string>();
  return (
    <View style={s.layout}>
      <Hero session={props.session} item={{ kind: 'album', data: album }} />
      <View style={s.content}>
        {result?.length ? (
          <>
            <Actions
              {...props}
              tracks={result}
              index={0}
              label={album.title}
              entity="album"
              active={props.active && !selected}
            />
            <View style={s.headingRow}>
              <Text style={s.sectionHeading}>Tracks</Text>
              <Text style={s.muted}>{result.length}</Text>
            </View>
            <LibraryResults
              items={result.map((data) => ({ kind: 'track', data }))}
              session={props.session}
              layout="album"
              active={props.active}
              initialKey={selected}
              onOpen={(item) => {
                const index = result.findIndex((track) => track.id === item.data.id);
                if (index >= 0) {
                  setSelected(itemKey(item));
                  onSong(result, index, album.title);
                }
              }}
            />
          </>
        ) : (
          <Notice
            error={error}
            retry={retry}
            empty={result ? 'This album has no playable tracks.' : undefined}
          />
        )}
      </View>
    </View>
  );
}

export function LinkedMusicScreen({ link, ...props }: Props & {link: PlaybackLink}) {
  const read = useCallback((signal: AbortSignal) => playbackDestination(props.session, link, signal), [props.session, link]);
  const {result, error, retry} = useRead(read, props.revision, props.onExpired);
  if (!result) return <Notice error={error} retry={retry} />;
  return <MusicLibraryScreen {...props} initialRoute={result} />;
}

export function MusicLibraryScreen(props: Props & {initialRoute?: PlaybackDestination}) {
  const [section, setSection] = useState<Section>('artists');
  const [routes, setRoutes] = useState<Route[]>(() => props.initialRoute ? [props.initialRoute] : []);
  const nestedBack = useRef<(() => boolean) | null>(null);
  const enteredFromContent = useRef(false);
  const push = (route: Route) => {
    enteredFromContent.current = true;
    setRoutes((old) => [...old, route]);
  };
  useEffect(() => {
    if (!props.active) return;
    const back = () => {
      if (routes.length > (props.initialRoute ? 1 : 0)) {
        setRoutes((old) => old.slice(0, -1));
        return true;
      }
      if ((section === 'genres' || section === 'favorites') && nestedBack.current?.()) return true;
      return false;
    };
    props.backRef.current = back;
    return () => {
      if (props.backRef.current === back) props.backRef.current = null;
    };
  }, [props.active, props.backRef, props.initialRoute, routes.length, section]);
  const onSong: OpenSong = (tracks, index, source) => push({ type: 'song', tracks, index, source });
  const onOpen = (item: LibraryItem) => {
    if (item.kind === 'artist') push({ type: 'artist', artist: item.data });
    if (item.kind === 'album') push({ type: 'album', album: item.data });
    if (item.kind === 'track') onSong([item.data], 0, item.data.albumName || 'Songs');
  };
  const rootActive = props.active && !routes.length;
  return (
    <View style={s.screen}>
      {!props.initialRoute && <View style={[s.layout, routes.length > 0 && s.hidden]}>
        <View style={s.nav}>
          <Text accessibilityRole="header" style={s.navHeading}>
            Your library
          </Text>
          {sections.map((tab) => (
            <NavItem
              key={tab}
              name={names[tab]}
              selected={section === tab}
              active={rootActive && !enteredFromContent.current}
              onPress={() => {
                enteredFromContent.current = false;
                setSection(tab);
              }}
            />
          ))}
        </View>
        {section === 'search' ? (
          <Search
            {...props}
            active={rootActive}
            onOpen={onOpen}
            onMore={(kind, query) => push({ type: 'results', kind, query })}
          />
        ) : section === 'genres' || section === 'favorites' ? (
          <View style={s.content}>
            <LibraryFiltersScreen
              {...props}
              kind={section}
              active={rootActive}
              backRef={nestedBack}
              onArtist={(artist) => onOpen({ kind: 'artist', data: artist })}
              onAlbum={(album) => onOpen({ kind: 'album', data: album })}
              onSong={onSong}
            />
          </View>
        ) : (
          <Browse
            key={section}
            {...props}
            active={rootActive}
            kind={section}
            onOpen={onOpen}
            returning={false}
          />
        )}
      </View>}
      {routes.map((route, i) => {
        const visible = i === routes.length - 1;
        const active = visible && props.active;
        return (
          <View key={i} style={[s.screen, !visible && s.hidden]}>
            {route.type === 'artist' ? (
              <View style={s.layout}>
                <Hero session={props.session} item={{ kind: 'artist', data: route.artist }} />
                <Browse {...props} active={active} kind="albums" artistId={route.artist.id} onOpen={onOpen} />
              </View>
            ) : route.type === 'album' ? (
              <AlbumScreen {...props} active={active} album={route.album} onSong={onSong} />
            ) : route.type === 'results' ? (
              <Browse {...props} active={active} kind={route.kind} query={route.query} onOpen={onOpen} />
            ) : (
              <View style={s.layout}>
                <Hero session={props.session} item={{ kind: 'track', data: route.tracks[route.index] }}>
                  <Text numberOfLines={1} style={s.muted}>
                    {route.tracks[route.index].albumName}
                  </Text>
                </Hero>
                <View style={s.songPanel}>
                  <Text style={s.sectionHeading}>Song actions</Text>
                  <Actions
                    {...props}
                    active={active}
                    tracks={route.tracks}
                    index={route.index}
                    label={route.source}
                    entity="song"
                  />
                  {!!route.tracks[route.index].durationMs && (
                    <Text style={s.muted}>{timeLabel(route.tracks[route.index].durationMs!)}</Text>
                  )}
                </View>
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, minHeight: 0 },
  hidden: { display: 'none' },
  layout: { flex: 1, flexDirection: 'row', gap: 24, minHeight: 0, paddingTop: 12 },
  nav: { width: 155, borderRightWidth: 1, borderRightColor: color.surface, paddingRight: 12 },
  navHeading: { color: color.ink, fontSize: 22, fontWeight: '700', marginBottom: 10 },
  navItem: {
    height: 40,
    borderWidth: 2,
    borderColor: 'transparent',
    borderRadius: 5,
    paddingHorizontal: 10,
    justifyContent: 'center',
  },
  navSelected: { backgroundColor: color.surface },
  navTitle: { color: color.secondary, fontWeight: '600', fontSize: 17 },
  navCurrent: { color: color.ink },
  focus: { borderColor: color.lime, backgroundColor: color.raised },
  content: { flex: 1, minHeight: 0, minWidth: 0, gap: 7 },
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  heading: { fontSize: 27, fontWeight: '700', color: color.ink, letterSpacing: -0.65 },
  headerCopy: { flex: 1 },
  sectionHeading: { fontSize: 21, fontWeight: '700', color: color.ink },
  muted: { fontSize: 15, color: color.muted },
  error: { fontSize: 16, color: color.error },
  notice: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  pager: { flexDirection: 'row', gap: 12, justifyContent: 'flex-end', alignItems: 'center' },
  input: {
    color: color.ink,
    borderWidth: 2,
    borderColor: color.border,
    borderRadius: 5,
    paddingHorizontal: 12,
    height: 44,
    fontSize: 18,
  },
  searchGroup: { marginTop: 6, marginBottom: 12 },
  hit: {
    height: 43,
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 6,
    borderWidth: 2,
    borderColor: 'transparent',
    borderRadius: 5,
  },
  hitTitle: { fontSize: 16, color: color.ink, fontWeight: '600', flex: 1 },
  hitArtist: { fontSize: 14, color: color.muted, maxWidth: '42%' },
  hero: { gap: 5, alignItems: 'flex-start', paddingTop: 3 },
  heroTitle: { color: color.ink, fontSize: 26, fontWeight: '700', marginTop: 10, letterSpacing: -0.5 },
  artist: { fontSize: 18, color: color.secondary },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, alignItems: 'center' },
  songPanel: { flex: 1, alignItems: 'flex-start', justifyContent: 'center', gap: 13 },
  feedback: { fontSize: 15, color: color.secondary },
});
