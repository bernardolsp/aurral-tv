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
const { albumTracks, libraryPage, playbackDestination, readArtistMonitoring, searchMusicLibrary, setArtistMonitoring } = await import('../src/musicLibrary.ts');
hooks.deregister();

function session() {
  return {
    serverUrl: 'https://tv.example/prefix',
    token: 'example-session',
    customHeaders: { 'X-Fixture': 'proxy' },
  };
}
const mbid = '12345678-1234-1234-1234-123456789abc';
const artist = { id: 10, mbid, name: 'Example Band', albumCount: 2, coverUrl: '/api/library/artists/10/cover?v=5' };
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

test('artist monitoring uses the paired account and only writes on explicit changes', async (t) => {
  const path = '/prefix/api/library/artists/' + mbid;
  let monitored = false;
  let canChange = false;
  const writes: unknown[] = [];
  t.mock.method(globalThis, 'fetch', async (uri: string, init: RequestInit) => {
    const url = new URL(uri);
    assert.equal(url.origin, 'https://tv.example');
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer example-session');
    assert.equal(new Headers(init.headers).get('X-Fixture'), 'proxy');
    if (init.method === 'PUT') {
      assert.equal(url.pathname, path);
      const body = JSON.parse(String(init.body));
      writes.push(body);
      monitored = body.monitoring.monitored;
      return Response.json({ monitored });
    }
    assert.equal(init.method, 'GET');
    if (url.pathname === '/prefix/api/auth/me') {
      return Response.json({ user: { permissions: { changeMonitoring: canChange } } });
    }
    assert.equal(url.pathname, path + '/monitoring');
    return Response.json({ added: true, monitored, useDefault: true });
  });
  const read = () => readArtistMonitoring(session(), mbid, new AbortController().signal);
  assert.deepEqual(await read(), { monitored: false, customRules: false, canChange: false });
  canChange = true;
  assert.equal((await read()).canChange, true);
  assert.equal(writes.length, 0);
  await setArtistMonitoring(session(), mbid, artist.name, true);
  assert.equal((await read()).monitored, true);
  await setArtistMonitoring(session(), mbid, artist.name, false);
  assert.equal((await read()).monitored, false);
  assert.deepEqual(writes, [
    { artistName: artist.name, monitoring: { monitored: true, useDefault: true } },
    { artistName: artist.name, monitoring: { monitored: false } },
  ]);
  await assert.rejects(setArtistMonitoring(session(), '10', artist.name, true), /MusicBrainz/);
});

test('playback links use the streamed release and respect guest artist credits', async (t) => {
  const guest = { ...artist, id: 35, name: 'Guest' };
  t.mock.method(globalThis, 'fetch', async (uri: string) => {
    const url = new URL(uri);
    if (url.pathname.endsWith('/bootstrap')) return Response.json({ api: {} });
    if (url.searchParams.get('kind') === 'tracks') {
      assert.equal(url.searchParams.get('albumId'), '12');
      return Response.json(base());
    }
    assert.equal(url.searchParams.get('kind'), 'artists');
    assert.equal(url.searchParams.get('query'), guest.name);
    return Response.json({ ...base(), artists: [guest] });
  });
  const track = { artist: guest.name, albumName: 'Playlist title', streamPath: '/api/library/stream/12/50' };
  const release = await playbackDestination(session(), { ...track, kind: 'album' });
  assert.equal(release.type === 'album' && release.album.id, '12');
  const credit = await playbackDestination(session(), { ...track, kind: 'artist' });
  assert.equal(credit.type === 'artist' && credit.artist.id, '35');
});

test('playlist metadata opens an exact release or shows choices when more than one matches', async (t) => {
  const albums = [album, { ...album, id: 13, artistId: 11 }];
  t.mock.method(globalThis, 'fetch', async () => Response.json({
    ...base(), artists: [artist, { ...artist, id: 11, name: 'Other band' }], albums,
  }));
  const link = { kind: 'album' as const, albumName: album.title, artist: artist.name, streamPath: null };
  const match = await playbackDestination(session(), link);
  assert.equal(match.type === 'album' && match.album.id, '12');
  albums.push({ ...album, id: 14 });
  assert.deepEqual(await playbackDestination(session(), link), { type: 'results', kind: 'albums', query: album.title });
});

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
  assert.equal(page.artists[0].mbid, mbid);
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
