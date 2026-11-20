export type Setup = { serverUrl: string; code: string; customHeaders: Record<string, string> };
export type Connection = Omit<Setup, 'code'> & { token: string };

export function serverAddress(raw: string): string {
  try {
    if (raw.length > 2048) throw new Error();
    const url = new URL(raw.trim());
    if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash) throw new Error();
    return url.href.replace(/\/+$/, '');
  } catch {
    throw new Error('Enter a server address beginning with http:// or https://.');
  }
}

const reserved = new Set(['authorization', 'content-type', 'content-length', 'accept', 'host', 'range',
  'connection', 'transfer-encoding', 'accept-encoding', 'proxy-authorization', 'set-cookie',
  'upgrade', 'expect', 'trailer', 'te', 'keep-alive', '__proto__', 'constructor', 'prototype']);

export function proxyHeaders(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid proxy headers.');
  const headers: Record<string, string> = Object.create(null);
  if (Object.keys(raw).length > 32) throw new Error('Too many proxy headers.');
  const names = new Set<string>();
  for (const [name, value] of Object.entries(raw)) {
    const lower = name.toLowerCase();
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/.test(name) || reserved.has(lower) || names.has(lower) ||
        typeof value !== 'string' || !/^[\x20-\x7e]{0,4096}$/.test(value)) {
      throw new Error('Invalid proxy header name or value.');
    }
    names.add(lower);
    headers[name] = value;
  }
  return headers;
}

export function serverResource(session: Connection, path: string) {
  if (!path.startsWith('/api/') || /[\\?#]/.test(path) || path.split('/').includes('..')) throw new Error('Invalid server resource.');
  const base = serverAddress(session.serverUrl);
  const uri = base + path;
  if (new URL(uri).origin !== new URL(base).origin) throw new Error('Invalid resource origin.');
  return { uri, headers: { ...proxyHeaders(session.customHeaders), Authorization: 'Bearer ' + session.token } };
}
