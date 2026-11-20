export type LyricLine = { value: string; start?: number };
export type Lyrics = { synced: boolean; lines: LyricLine[] };

type Song = {
  artist: string | null;
  title: string | null;
  albumName: string | null;
  streamPath: string | null;
  durationMs: number | null;
};

export function lyricsQuery(song: Song) {
  if (!song.artist?.trim() || !song.title?.trim()) return null;
  const query = new URLSearchParams({ artist: song.artist, title: song.title });
  if (song.albumName) query.set('album', song.albumName);
  if (song.durationMs && song.durationMs > 0)
    query.set('durationMs', String(Math.round(song.durationMs)));
  const ids = /^\/(?:api\/)?library\/stream\/([^/?#]+)\/([^/?#]+)$/.exec(song.streamPath ?? '');
  if (ids) {
    query.set('libraryAlbumId', decodeURIComponent(ids[1]));
    query.set('libraryTrackId', decodeURIComponent(ids[2]));
  }
  return query.toString();
}

export function readLyrics(input: unknown): Lyrics | null {
  if (!input || typeof input !== 'object' || !('lines' in input) || !Array.isArray(input.lines))
    return null;
  const lines: LyricLine[] = [];
  for (const line of input.lines) {
    if (typeof line?.value !== 'string') continue;
    const start = line.start;
    lines.push(
      typeof start === 'number' && Number.isFinite(start) && start >= 0
        ? { value: line.value, start }
        : { value: line.value },
    );
  }
  if (!lines.some((line) => line.value.trim())) return null;
  const synced =
    'synced' in input &&
    input.synced === true &&
    lines.every((line, i) => line.start !== undefined && (!i || line.start >= lines[i - 1].start!));
  return { synced, lines };
}

export function sungLine(lines: LyricLine[], positionMs: number) {
  let lo = 0;
  let hi = lines.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if ((lines[mid].start ?? Infinity) <= positionMs) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}
