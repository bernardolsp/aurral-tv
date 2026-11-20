import { fetch } from 'expo/fetch';
import { proxyHeaders, serverAddress, serverResource, type Connection, type Setup } from './connection';

export type Collection = { id: string; name: string; kind: 'Playlist' | 'Flow' };
export type Track = { id: string; title: string; artist: string };
export class ExpiredSession extends Error {}

async function request(uri: string, headers: Record<string,string>, body?: object, signal?: AbortSignal) {
  const response = await fetch(uri, {
    method: body ? 'POST' : 'GET', headers: { ...headers, 'Content-Type': 'application/json' },
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
  return { serverUrl, customHeaders, token };
}

async function get(session: Connection, path: string) {
  const {uri, headers} = serverResource(session, path);
  return (await request(uri, headers)).json();
}

export async function collections(session: Connection): Promise<Collection[]> {
  const data = await get(session, '/api/playlists/status');
  return [
    ...data.staticPlaylists.map((p: Collection) => ({id: p.id, name: p.name, kind: 'Playlist' as const})),
    ...data.flows.map((p: Collection) => ({id: p.id, name: p.name, kind: 'Flow' as const})),
  ];
}

export async function tracks(session: Connection, collection: Collection): Promise<Track[]> {
  const data: {id: string; trackName: string; artistName: string; status: string}[] =
    await get(session, '/api/playlists/jobs/' + encodeURIComponent(collection.id));
  return data.filter(t => t.status === 'done').map(t => ({id: t.id, title: t.trackName, artist: t.artistName}));
}

export async function cover(session: Connection, collectionId: string, signal: AbortSignal) {
  const { uri, headers } = serverResource(session, '/api/playlists/artwork/' + encodeURIComponent(collectionId));
  const response = await request(uri, headers, undefined, signal);
  const mime = response.headers.get('Content-Type')?.split(';')[0];
  if (!mime || !['image/jpeg', 'image/png', 'image/webp'].includes(mime)) return null;
  const limit = 2 * 1024 * 1024;
  if (Number(response.headers.get('Content-Length')) > limit) return null;
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
  return 'data:' + mime + ';base64,' + btoa(parts.join(''));
}

export async function logout(session: Connection) {
  const {uri, headers} = serverResource(session, '/api/auth/logout');
  await request(uri, headers, {});
}
