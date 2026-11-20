import { fetch } from 'expo/fetch';
import { proxyHeaders, serverAddress, serverResource, type Connection, type Setup } from './connection';

import { albumArtworkPath, catalogAlbumImage, exactLibraryCover, playlistTracks, publicAlbumImage } from './playlistStreams';
export type { Track } from './playlistStreams';

export type Collection = {
  id: string; name: string; kind: 'Playlist' | 'Flow'; trackCount?: number; description?: string;
  streamTranscoding?: boolean;
};
export class ExpiredSession extends Error {}

export async function request(uri: string, headers: Record<string,string>, body?: object, signal?: AbortSignal, method: 'GET' | 'POST' | 'PUT' = body ? 'POST' : 'GET') {
  const response = await fetch(uri, {
    method, headers: { ...headers, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'error', credentials: 'omit', signal: signal ?? AbortSignal.timeout(20000),
  });
  if (response.status === 401 && headers.Authorization) throw new ExpiredSession('Pair this TV again to sign in.');
  if (response.status === 401) throw new Error('The server refused the code or proxy credentials.');
  if (response.status === 403) throw new Error('This account or proxy denied access.');
  if (!response.ok) throw new Error('The server returned HTTP ' + response.status + '.');
  return response;
}

export async function pair(setup: Setup): Promise<Connection> {
  const serverUrl = serverAddress(setup.serverUrl);
  const customHeaders = proxyHeaders(setup.customHeaders);
  const code = setup.code.replace(/[\s-]/g, '').toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(code)) throw new Error('Enter the 10-character pairing code.');
  const response = await request(serverUrl + '/api/auth/pair', customHeaders, {code});
  const {token} = await response.json();
  if (typeof token !== 'string' || !token) throw new Error('The server returned an invalid session.');
  return { serverUrl, customHeaders, token, ...(setup.remoteKey && { remoteKey: setup.remoteKey }) };
}

async function get(session: Connection, path: string, signal?: AbortSignal) {
  const {uri, headers} = serverResource(session, path);
  return (await request(uri, headers, undefined, signal)).json();
}

export async function accountId(session: Connection): Promise<number> {
  const me = await get(session, '/api/auth/me');
  const id = me?.user?.id;
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Could not verify the Aurral account.');
  return id;
}

export async function collections(session: Connection, signal?: AbortSignal): Promise<Collection[]> {
  const [data, health] = await Promise.all([
    get(session, '/api/playlists/status', signal),
    get(session, '/api/health/bootstrap', signal).catch(() => null),
  ]);
  const streamTranscoding = Array.isArray(health?.api?.features) && health.api.features.includes('streamTranscoding');
  return [
    ...data.staticPlaylists.map((p: Collection) => ({
      id: p.id, name: p.name, kind: 'Playlist' as const, trackCount: p.trackCount, description: p.description, streamTranscoding,
    })),
    ...data.flows.map((p: Collection) => ({
      id: p.id, name: p.name, kind: 'Flow' as const, trackCount: data.flowStats?.[p.id]?.total, description: p.description, streamTranscoding,
    })),
  ];
}

export async function tracks(session: Connection, collection: Collection, signal?: AbortSignal) {
  const data = await get(session, '/api/playlists/jobs/' + encodeURIComponent(collection.id), signal);
  return playlistTracks(data, collection.streamTranscoding === true);
}

export function cover(session: Connection, collectionId: string, signal: AbortSignal) {
  return fetchCover(session, '/api/playlists/artwork/' + encodeURIComponent(collectionId), signal);
}

export function libraryEntityCover(session: Connection, path: string, signal: AbortSignal) {
  if (!/^\/api\/library\/(?:artwork\/(?:artist|album)\/[a-zA-Z0-9_-]+|(?:artists|albums)\/[a-zA-Z0-9_-]+\/cover)(?:\?v=[a-zA-Z0-9_.-]+)?$/.test(path)) return Promise.resolve(null);
  return fetchCover(session, path, signal);
}

export async function trackCover(session: Connection, artworkPath: string, signal: AbortSignal) {
  const safePath = albumArtworkPath(artworkPath);
  if (!safePath) return null;
  if (!safePath.startsWith('/api/artists/release-group/')) return fetchCover(session, safePath, signal);

  // The image endpoint redirects. Read the same front-cover metadata as Pocket
  // and start a separate, unauthenticated request for known public providers.
  const resource = serverResource(session, safePath.slice(0, -'/image'.length));
  const page = await (await request(resource.uri, resource.headers, undefined, signal)).json();
  const images = Array.isArray(page?.images) ? page.images : [];
  const raw = (images.find((img: {front?: boolean}) => img?.front) ?? images[0])?.image;
  if (typeof raw !== 'string') return null;
  const serverPrefix = session.serverUrl + '/api/';
  const local = albumArtworkPath(raw.startsWith(serverPrefix) ? raw.slice(session.serverUrl.length) : raw);
  if (local && !local.startsWith('/api/artists/release-group/')) return fetchCover(session, local, signal);
  return fetchPublicCover(raw, signal);
}

async function fetchPublicCover(raw: string, signal: AbortSignal) {
  let url = publicAlbumImage(raw);
  for (let attempt = 0; url && attempt < 4; attempt++) {
    const response = await fetch(url, { credentials: 'omit', redirect: 'manual', signal });
    if (response.status >= 300 && response.status < 400) {
      url = publicAlbumImage(response.headers.get('location'), url);
      await response.body?.cancel();
    } else {
      return response.ok ? readCover(response) : null;
    }
  }
  return null;
}

export async function libraryAlbumCover(session: Connection, artist: string, album: string, signal: AbortSignal) {
  const resource = serverResource(session, '/api/search/library');
  const params = new URLSearchParams({ q: album, limit: '30' });
  const result = await request(resource.uri + '?' + params, resource.headers, undefined, signal);
  const page = await result.json();
  const path = exactLibraryCover(page?.albums, artist, album);
  if (path) {
    try {
      const cover = await fetchCover(session, path, signal);
      if (cover) return cover;
    } catch (error) {
      if (signal.aborted || error instanceof ExpiredSession) throw error;
    }
  }
  const catalog = serverResource(session, '/api/search/unified');
  const query = new URLSearchParams({ q: artist + ' ' + album, limit: '12' });
  const response = await request(catalog.uri + '?' + query, catalog.headers, undefined, signal);
  const image = catalogAlbumImage((await response.json())?.tracks, artist, album);
  return image ? fetchPublicCover(image, signal) : null;
}

async function fetchCover(session: Connection, path: string, signal: AbortSignal) {
  const at = path.indexOf('?');
  const resource = serverResource(session, at < 0 ? path : path.slice(0, at));
  const { headers } = resource;
  const uri = resource.uri + (at < 0 ? '' : path.slice(at));
  const response = await request(uri, headers, undefined, signal);
  return readCover(response);
}

async function readCover(response: Awaited<ReturnType<typeof fetch>>) {
  const mime = response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
  const limit = 2 * 1024 * 1024;
  if (Number(response.headers.get('Content-Length')) > limit) {
    await response.body?.cancel();
    return null;
  }
  const reader = response.body?.getReader();
  if (!reader) return null;
  let size = 0;
  const parts: string[] = [];
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) { await reader.cancel(); return null; }
    for (let i = 0; i < value.length; i += 8192) parts.push(String.fromCharCode(...value.subarray(i, i + 8192)));
  }
  const bytes = parts.join('');
  const type = bytes.startsWith('\xff\xd8\xff') ? 'image/jpeg' :
    bytes.startsWith('\x89PNG\r\n\x1a\n') ? 'image/png' :
    bytes.startsWith('RIFF') && bytes.slice(8, 12) === 'WEBP' ? 'image/webp' : null;
  if (!type || (mime && !mime.startsWith('image/') && mime !== 'application/octet-stream')) return null;
  return 'data:' + type + ';base64,' + btoa(bytes);
}

export async function logout(session: Connection) {
  const {uri, headers} = serverResource(session, '/api/auth/logout');
  await request(uri, headers, {});
}
