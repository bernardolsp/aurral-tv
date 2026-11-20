import { request } from './api';
import { serverResource, type Connection } from './connection';

export type LibraryGenre = { name: string; albums: number; tracks: number };

export async function libraryGenres(session: Connection, signal: AbortSignal): Promise<LibraryGenre[]> {
  const { uri, headers } = serverResource(session, '/api/library');
  const params = new URLSearchParams({ kind: 'genres', source: 'all', availableOnly: 'true', pageSize: '100' });
  const response = await request(uri + '?' + params, headers, undefined, signal);
  const page = await response.json();
  // Aurral includes the complete genre statistics in "genres" alongside the paged "items".
  if (!Array.isArray(page?.genres)) throw new Error('The server did not return library genres.');
  return page.genres.flatMap((row: Partial<LibraryGenre> | null) => {
    if (typeof row?.name !== 'string' || !row.name.trim()) return [];
    return [{ name: row.name, albums: Math.max(0, Number(row.albums) || 0), tracks: Math.max(0, Number(row.tracks) || 0) }];
  }).sort((a: LibraryGenre, b: LibraryGenre) => a.name.localeCompare(b.name));
}
