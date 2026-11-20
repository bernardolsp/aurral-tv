export type Track = {
  id: string; title: string; artist: string; streamPath: string; transcode: boolean;
  durationMs: number | null; albumName: string | null; artworkPath: string | null;
};

type Job = {
  id?: string; status?: string; trackName?: string; artistName?: string; albumName?: string;
  artworkUrl?: string; albumMbid?: string; durationMs?: number; streamFormat?: string; qualityFormat?: string;
  qualityBitrateKbps?: number;
};

export function albumArtworkPath(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 2048) return null;
  if (/^\/api\/library\/artwork\/album\/[a-zA-Z0-9_-]+(?:\?v=[a-zA-Z0-9_.-]+)?$/.test(input)) return input;
  if (/^\/api\/library\/albums\/[a-zA-Z0-9_-]+\/cover(?:\?v=[a-zA-Z0-9_.-]+)?$/.test(input)) return input;
  if (/^\/api\/artists\/release-group\/[a-f0-9-]{36}\/cover\/image$/i.test(input)) return input;
  if (!/^\/api\/playlists\/track-artwork\/[a-zA-Z0-9_-]+(?:\?[^#\\]*)?$/.test(input)) return null;
  const url = new URL(input, 'https://aurral.invalid');
  for (const key of url.searchParams.keys()) {
    if (key !== 'playlistId' && key !== 'v') return null;
  }
  return url.pathname + url.search;
}

export function playlistTracks(jobs: Job[], streamTranscoding: boolean): Track[] {
  return jobs.flatMap(job => {
    const id = job?.id;
    if (job?.status !== 'done' || typeof id !== 'string' || !id.trim() || id === '.' || id === '..') return [];
    const source = (job.streamFormat || job.qualityFormat || '').toLowerCase().trim();
    const kbps = job.qualityBitrateKbps;
    const existingMp3 = source === 'mp3' && typeof kbps === 'number' && kbps > 0 && kbps <= 320;
    return [{
      id, title: job.trackName || '', artist: job.artistName || '', streamPath: '/api/playlists/stream/' + encodeURIComponent(id),
      transcode: streamTranscoding && !existingMp3,
      durationMs: typeof job.durationMs === 'number' && Number.isFinite(job.durationMs) && job.durationMs > 0 ? job.durationMs : null,
      albumName: job.albumName || null, artworkPath: albumArtworkPath(job.artworkUrl) ??
        (typeof job.albumMbid === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(job.albumMbid)
          ? '/api/artists/release-group/' + job.albumMbid + '/cover/image' : null),
    }];
  });
}

export function albumNameKey(input: unknown) {
  return typeof input === 'string' ? input.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase() : '';
}

type AlbumHit = {libraryId?: unknown; artistName?: unknown; title?: unknown; coverUrl?: unknown};

export function exactLibraryCover(hits: unknown, artist: string, album: string): string | null {
  if (!Array.isArray(hits) || !albumNameKey(artist) || !albumNameKey(album)) return null;
  const matches = new Map<string, string>();
  for (const hit of hits as AlbumHit[]) {
    if (albumNameKey(hit?.artistName) !== albumNameKey(artist) || albumNameKey(hit?.title) !== albumNameKey(album)) continue;
    const id = String(hit.libraryId ?? '');
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) continue;
    const fallback = '/api/library/albums/' + id + '/cover';
    const path = albumArtworkPath(hit.coverUrl);
    // Honor versioned and custom covers, only for the matched Library album.
    const named = path?.split('?')[0];
    matches.set(id, named === fallback || named === '/api/library/artwork/album/' + id ? path! : fallback);
  }
  return matches.size === 1 ? [...matches.values()][0] : null;
}

export function publicAlbumImage(input: unknown, base?: string): string | null {
  if (typeof input !== 'string' || input.length > 2048) return null;
  try {
    const url = new URL(input, base);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return null;
    const host = url.hostname;
    if (host === 'coverartarchive.org' && /^\/(release|release-group)\//.test(url.pathname) ||
        host === 'archive.org' && url.pathname.startsWith('/download/mbid-') ||
        /^ia[0-9]+(?:\.[a-z0-9-]+)?\.archive\.org$/.test(host) && /\/items\/mbid-/.test(url.pathname) ||
        /^(?:cdn-images|[a-z]-cdns-images)\.dzcdn\.net$/.test(host) && url.pathname.startsWith('/images/cover/') ||
        /^is[0-9]+(?:-ssl)?\.mzstatic\.com$/.test(host) && url.pathname.startsWith('/image/') ||
        host === 'i.scdn.co' && url.pathname.startsWith('/image/')) return url.href;
  } catch {}
  return null;
}

export type CoverTrack = { id: string | null; artist: string | null; albumName: string | null; artworkPath: string | null };

export function artworkCandidates(collectionId: string, track?: CoverTrack) {
  if (!track) return ['collection:' + collectionId];
  const artist = albumNameKey(track.artist);
  const album = albumNameKey(track.albumName);
  const lookup = artist && album && artist.length <= 512 && album.length <= 512
    ? ['album:' + JSON.stringify([artist, album])] : [];
  const path = albumArtworkPath(track.artworkPath);
  if (!path) return lookup;
  const direct = 'track:' + path;
  return path.startsWith('/api/artists/release-group/') ? [...lookup, direct] : [direct, ...lookup];
}
