import { request } from './api';
import { serverResource, type Connection } from './connection';
import { albumNameKey, type Track } from './playlistStreams';

export type LibraryKind = 'artists' | 'albums' | 'tracks';
export type LibraryArtist = {
  id: string;
  name: string;
  artworkPath: string;
  albumCount: number;
};
export type LibraryAlbum = {
  id: string;
  title: string;
  artist: string;
  artistId: string | null;
  artworkPath: string;
  year: string | null;
  trackCount: number;
};
export type LibraryTrack = Track & { discNumber: number; trackNumber: number };
export type LibraryPage = {
  page: number;
  total: number;
  hasMore: boolean;
  artists: LibraryArtist[];
  albums: LibraryAlbum[];
  tracks: LibraryTrack[];
};
type Options = {
  kind: LibraryKind;
  page?: number;
  pageSize?: number;
  query?: string;
  artistId?: string;
  albumId?: string;
  favorite?: boolean;
  genre?: string;
  signal?: AbortSignal;
};

type Id = string | number;
type ArtistRow = { id: Id; name?: string; albumCount?: number; coverUrl?: string };
type AlbumRow = {
  id: Id;
  title?: string;
  albumArtist?: string;
  artistId?: Id;
  releaseDate?: string;
  availableTrackCount?: number;
  trackCount?: number;
  coverUrl?: string;
};
type TrackFile = {
  available?: boolean;
  albumId?: Id | null;
  durationMs?: number;
  format?: string;
  quality?: { format?: string; bitrate?: number };
};
type TrackRow = {
  id: Id;
  title?: string;
  artistName?: string;
  artworkUrl?: string;
  files?: TrackFile[];
  albums?: { albumId: Id; discNumber?: number; trackNumber?: number }[];
};
type WirePage = {
  page: number;
  total: number;
  hasMore: boolean;
  artists: ArtistRow[];
  albums: AlbumRow[];
  tracks: TrackRow[];
};

function canonicalId(value: unknown): string | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const id = String(value);
  return /^[1-9]\d*$/.test(id) ? id : null;
}

// Both routes are owned by the configured server. Retain only versioned URLs
// for this particular entity, including custom artwork set in Aurral.
function artwork(kind: 'artist' | 'album', id: string, supplied?: string) {
  const canonical = '/api/library/' + kind + 's/' + id + '/cover';
  if (typeof supplied !== 'string') return canonical;
  const [path, version] = supplied.split('?');
  const custom = '/api/library/artwork/' + kind + '/' + id;
  if (path !== canonical && path !== custom) return canonical;
  return version && /^v=[a-zA-Z0-9_.-]+$/.test(version) ? path + '?' + version : path;
}

function mapPage(raw: WirePage, albumId: string | undefined, transcode: boolean): LibraryPage {
  if (
    !Number.isSafeInteger(raw?.page) ||
    raw.page < 1 ||
    !Number.isSafeInteger(raw.total) ||
    raw.total < 0 ||
    typeof raw.hasMore !== 'boolean' ||
    !Array.isArray(raw.artists) ||
    !Array.isArray(raw.albums) ||
    !Array.isArray(raw.tracks)
  )
    throw new Error('The server returned an invalid library page.');

  const artists = raw.artists.flatMap((row) => {
    const id = canonicalId(row?.id);
    return id
      ? [
          {
            id,
            name: row.name || 'Unknown artist',
            albumCount: row.albumCount ?? 0,
            artworkPath: artwork('artist', id, row.coverUrl),
          },
        ]
      : [];
  });
  const artistNames = new Map(artists.map((artist) => [artist.id, artist.name]));
  const albums = raw.albums.flatMap((row) => {
    const id = canonicalId(row?.id);
    if (!id) return [];
    const artistId = canonicalId(row.artistId);
    return [
      {
        id,
        title: row.title || 'Unknown album',
        artistId,
        artist: (artistId && artistNames.get(artistId)) || row.albumArtist || 'Unknown artist',
        artworkPath: artwork('album', id, row.coverUrl),
        year: String(row.releaseDate ?? '').match(/^\d{4}/)?.[0] ?? null,
        trackCount: row.availableTrackCount ?? row.trackCount ?? 0,
      },
    ];
  });
  const albumById = new Map(albums.map((album) => [album.id, album]));
  const tracks = raw.tracks.flatMap((row) => {
    const id = canonicalId(row?.id);
    if (!id) return [];
    const files = row.files?.filter((file) => file?.available === true) ?? [];
    const relations = row.albums ?? [];
    // Pocket selects an available album-scoped copy first, then an unscoped file.
    const mediaAlbum =
      albumId ??
      canonicalId(files.find((file) => canonicalId(file.albumId))?.albumId) ??
      canonicalId(relations[0]?.albumId);
    if (!mediaAlbum) return [];
    const file =
      files.find((item) => canonicalId(item.albumId) === mediaAlbum) ??
      files.find((item) => item.albumId == null);
    if (!file) return [];
    const album = albumById.get(mediaAlbum);
    const position = relations.find((relation) => String(relation.albumId) === mediaAlbum);
    const format = String(file.quality?.format || file.format || '')
      .trim()
      .toLowerCase();
    const bitrate = Number(file.quality?.bitrate); // Aurral's scanner reports bits per second.
    const ownCover =
      typeof row.artworkUrl === 'string' &&
      row.artworkUrl.split('?')[0] === '/api/library/artwork/track/' + id &&
      /^\/api\/library\/artwork\/track\/[1-9]\d*(?:\?v=[a-zA-Z0-9_.-]+)?$/.test(row.artworkUrl)
        ? row.artworkUrl
        : null;
    return [
      {
        id,
        title: row.title || 'Unknown title',
        artist: row.artistName || album?.artist || 'Unknown artist',
        albumName: album?.title ?? null,
        artworkPath: ownCover ?? album?.artworkPath ?? artwork('album', mediaAlbum),
        streamPath: '/api/library/stream/' + mediaAlbum + '/' + id,
        transcode: transcode && !(format === 'mp3' && bitrate > 0 && bitrate <= 320_000),
        durationMs: file.durationMs && file.durationMs > 0 ? file.durationMs : null,
        discNumber: position?.discNumber ?? 1,
        trackNumber: position?.trackNumber ?? 0,
      },
    ];
  });
  return { page: raw.page, total: raw.total, hasMore: raw.hasMore, artists, albums, tracks };
}

const capabilities = new WeakMap<Connection, Promise<boolean>>();
function supportsTranscoding(session: Connection) {
  const known = capabilities.get(session);
  if (known) return known;
  const { uri, headers } = serverResource(session, '/api/health/bootstrap');
  const result = request(uri, headers)
    .then((response) => response.json())
    .then(
      (health) => Array.isArray(health?.api?.features) && health.api.features.includes('streamTranscoding'),
    )
    .catch(() => {
      capabilities.delete(session);
      return false;
    });
  capabilities.set(session, result);
  return result;
}

export async function libraryPage(session: Connection, options: Options): Promise<LibraryPage> {
  const page = options.page ?? 1;
  const pageSize = options.pageSize ?? 40;
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100
  )
    throw new Error('Invalid library page.');
  const params = new URLSearchParams({
    kind: options.kind,
    source: 'all',
    availableOnly: 'true',
    compact: 'true',
    page: String(page),
    pageSize: String(pageSize),
  });
  if (options.query?.trim()) params.set('query', options.query.trim());
  if (options.genre?.trim()) params.set('genre', options.genre.trim());
  if (options.favorite) params.set('favorite', 'true');
  for (const key of ['artistId', 'albumId'] as const) {
    const id = options[key];
    if (id !== undefined) {
      if (!canonicalId(id)) throw new Error('Invalid library identifier.');
      params.set(key, id);
    }
  }
  const { uri, headers } = serverResource(session, '/api/library');
  const [wire, transcode] = await Promise.all([
    request(uri + '?' + params, headers, undefined, options.signal).then((response) => response.json()),
    options.kind === 'tracks' ? supportsTranscoding(session) : false,
  ]);
  const result = mapPage(wire, options.albumId, transcode);
  if (result.page !== page) throw new Error('The server returned a different library page.');
  return result;
}

export async function albumTracks(
  session: Connection,
  albumId: string,
  signal?: AbortSignal,
): Promise<LibraryTrack[]> {
  const songs: LibraryTrack[] = [];
  const seen = new Set<string>();
  let current = 1;
  for (;;) {
    const page = await libraryPage(session, {
      kind: 'tracks',
      albumId,
      page: current,
      pageSize: 100,
      signal,
    });
    for (const track of page.tracks) {
      if (seen.has(track.id)) continue;
      seen.add(track.id);
      songs.push(track);
    }
    if (!page.hasMore || current * 100 >= page.total) break;
    current++;
  }
  return songs.sort((a, b) => a.discNumber - b.discNumber || a.trackNumber - b.trackNumber);
}

export async function searchMusicLibrary(session: Connection, query: string, signal?: AbortSignal) {
  if (!query.trim()) return { artists: [], albums: [], tracks: [] };
  const lookup = (kind: LibraryKind) => libraryPage(session, { kind, query, pageSize: 12, signal });
  const [artists, albums, tracks] = await Promise.all([
    lookup('artists'),
    lookup('albums'),
    lookup('tracks'),
  ]);
  return { artists: artists.artists, albums: albums.albums, tracks: tracks.tracks };
}

export type PlaybackLink = {
  kind: 'artist' | 'album';
  artist: string | null;
  albumName: string | null;
  streamPath: string | null;
};
export type PlaybackDestination =
  | { type: 'artist'; artist: LibraryArtist }
  | { type: 'album'; album: LibraryAlbum }
  | { type: 'results'; kind: 'albums' | 'artists'; query: string };

export async function playbackDestination(
  session: Connection, link: PlaybackLink, signal?: AbortSignal,
): Promise<PlaybackDestination> {
  const albumId = /^\/(?:api\/)?library\/stream\/([1-9]\d*)\/[1-9]\d*$/.exec(link.streamPath ?? '')?.[1];
  const query = (link.kind === 'artist' ? link.artist : link.albumName)?.trim();
  if (!query) throw new Error('This song is missing its ' + link.kind + ' name.');
  if (albumId) {
    // A track page also identifies its album and album artist, even for two releases with the same name.
    const page = await libraryPage(session, { kind:'tracks', albumId, pageSize:1, signal });
    const album = page.albums.find(row => row.id === albumId);
    if (album && link.kind === 'album') return {type:'album', album};
    const artist = page.artists.find(row => row.id === album?.artistId && albumNameKey(row.name) === albumNameKey(link.artist));
    if (artist) return {type:'artist', artist};
  }
  const kind = link.kind === 'artist' ? 'artists' : 'albums';
  const result = await libraryPage(session, {kind,query,pageSize:100,signal});
  if (!result.hasMore) {
    if (kind === 'artists') {
      const matches = result.artists.filter(row => albumNameKey(row.name) === albumNameKey(query));
      if (matches.length === 1) return {type:'artist',artist:matches[0]};
    } else {
      const matches = result.albums.filter(row => albumNameKey(row.title) === albumNameKey(query) &&
        albumNameKey(row.artist) === albumNameKey(link.artist));
      if (matches.length === 1) return {type:'album',album:matches[0]};
    }
  }
  return {type:'results',kind,query};
}
