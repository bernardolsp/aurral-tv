import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// Exercise the real TV HTTP request path with a simulated Expo transport.
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'expo/fetch') {
      return {
        url: 'data:text/javascript,export const fetch = (...args) => globalThis.fetch(...args)',
        shortCircuit: true,
      };
    }
    if (context.parentURL?.includes('/src/') && /^\.\/(api|connection|playlistStreams)$/.test(specifier)) {
      return next(specifier + '.ts', context);
    }
    return next(specifier, context);
  },
});
const { albumTracks, libraryPage, searchMusicLibrary } = await import('../src/musicLibrary.ts');
hooks.deregister();

function session() {
  return {
    serverUrl: 'https://tv.example/prefix',
    token: 'example-session',
    customHeaders: { 'X-Fixture': 'proxy' },
  };
}
const artist = { id: 10, name: 'Example Band', albumCount: 2, coverUrl: '/api/library/artists/10/cover?v=5' };
const album = {
  id: 12,
  title: 'Two discs',
  artistId: 10,
  releaseDate: '2011-02-03',
  availableTrackCount: 4,
  coverUrl: '/api/library/artwork/album/12?v=changed',
};
const file = {
  albumId: 12,
  durationMs: 192000,
  available: true,
  quality: { format: 'FLAC', bitrate: 950000 },
};
function base() {
  return { page: 1, hasMore: false, total: 1, artists: [artist], albums: [album], tracks: [] as unknown[] };
}

test('canonical album and artist references share the authenticated server prefix and artwork rules', async (t) => {
  const requests: URL[] = [];
  t.mock.method(globalThis, 'fetch', async (uri: string, init: RequestInit) => {
    const url = new URL(uri);
    requests.push(url);
    assert.equal(url.origin + url.pathname, 'https://tv.example/prefix/api/library');
    assert.deepEqual(init.headers, {
      'Content-Type': 'application/json',
      'X-Fixture': 'proxy',
      Authorization: 'Bearer example-session',
    });
    assert.equal(init.redirect, 'error');
    assert.equal(init.credentials, 'omit');
    return Response.json({
      ...base(),
      artists: [artist, { ...artist, id: 11, coverUrl: 'https://outside.example/photo' }],
    });
  });
  const page = await libraryPage(session(), {
    kind: 'albums',
    artistId: '10',
    query: ' band ',
    genre: 'Jazz',
    favorite: true,
  });
  assert.equal(requests[0].searchParams.get('artistId'), '10');
  assert.equal(requests[0].searchParams.get('availableOnly'), 'true');
  assert.equal(requests[0].searchParams.get('query'), 'band');
  assert.equal(requests[0].searchParams.get('favorite'), 'true');
  assert.equal(requests[0].searchParams.get('genre'), 'Jazz');
  assert.equal(page.albums[0].artist, artist.name);
  assert.equal(page.albums[0].artworkPath, '/api/library/artwork/album/12?v=changed');
  assert.equal(page.albums[0].year, '2011');
  assert.equal(page.artists[0].artworkPath, artist.coverUrl);
  assert.equal(page.artists[1].artworkPath, '/api/library/artists/11/cover');
});

test('an album queue reads later pages, selects the correct scoped files, and sorts disc then track', async (t) => {
  let healthReads = 0;
  const fetched: number[] = [];
  const makeTrack = (id: number, discNumber: number, trackNumber: number) => ({
    id,
    title: 'Track ' + id,
    artistName: 'Guest',
    albums: [
      { albumId: 12, discNumber, trackNumber },
      { albumId: 27, discNumber: 3, trackNumber: 4 },
    ],
    files: [file],
  });
  t.mock.method(globalThis, 'fetch', async (uri: string) => {
    const url = new URL(uri);
    if (url.pathname.endsWith('/bootstrap')) {
      healthReads++;
      return Response.json({ api: { features: ['streamTranscoding'] } });
    }
    assert.equal(url.searchParams.get('albumId'), '12');
    const page = Number(url.searchParams.get('page'));
    fetched.push(page);
    return Response.json({
      ...base(),
      page,
      total: 105,
      hasMore: page === 1,
      tracks:
        page === 1
          ? [
              makeTrack(42, 2, 1),
              { ...makeTrack(43, 1, 3), files: [{ ...file, albumId: 27 }] },
              { ...makeTrack(44, 1, 2), files: [{ ...file, quality: { format: 'MP3', bitrate: 320000 } }] },
            ]
          : [
              makeTrack(42, 2, 1),
              { ...makeTrack(45, 1, 1), artworkUrl: '/api/library/artwork/track/45?v=4' },
            ],
    });
  });
  const tracks = await albumTracks(session(), '12');
  assert.deepEqual(fetched, [1, 2]);
  assert.equal(healthReads, 1);
  assert.deepEqual(
    tracks.map((track) => track.id),
    ['45', '44', '42'],
  );
  assert.deepEqual(
    tracks.map((track) => track.transcode),
    [true, false, true],
  );
  assert.equal(tracks[0].artist, 'Guest');
  assert.equal(tracks[0].artworkPath, '/api/library/artwork/track/45?v=4');
  assert.equal(tracks[0].streamPath, '/api/library/stream/12/45');
});

test('unscoped song browsing chooses the album with an available file and older servers retain original format', async (t) => {
  t.mock.method(globalThis, 'fetch', async (uri: string) => {
    if (uri.includes('/bootstrap')) return new Response(null, { status: 404 });
    return Response.json({
      ...base(),
      tracks: [
        {
          id: 50,
          title: 'Alternate issue',
          albums: [{ albumId: 99 }, { albumId: 12 }],
          files: [{ ...file, albumId: 99, available: false }, file],
        },
      ],
    });
  });
  const result = await libraryPage(session(), { kind: 'tracks' });
  assert.equal(result.tracks[0].streamPath, '/api/library/stream/12/50');
  assert.equal(result.tracks[0].albumName, album.title);
  assert.equal(result.tracks[0].transcode, false);
});

test('search stays inside the local library and permission errors reach the UI', async (t) => {
  const seen: string[] = [];
  t.mock.method(globalThis, 'fetch', async (uri: string) => {
    const url = new URL(uri);
    if (url.pathname.endsWith('/bootstrap')) return Response.json({ api: {} });
    assert.equal(url.pathname, '/prefix/api/library');
    if (url.searchParams.get('query') === 'denied') return new Response(null, { status: 403 });
    seen.push(url.searchParams.get('kind')!);
    return Response.json(base());
  });
  await searchMusicLibrary(session(), 'twins');
  assert.deepEqual(seen.sort(), ['albums', 'artists', 'tracks']);
  await assert.rejects(libraryPage(session(), { kind: 'albums', query: 'denied' }), /denied access/);
});
