import test from 'node:test';
import assert from 'node:assert/strict';
import { lyricsQuery, readLyrics, sungLine } from '../src/lyrics.ts';
const song = {
  title: 'Stay & Listen',
  artist: 'Artist',
  albumName: 'Record',
  durationMs: 185000,
  streamPath: '/api/library/stream/31/204',
};
test('library lyrics lookup includes both file identifiers and uses millisecond duration', () => {
  const q = new URLSearchParams(lyricsQuery(song)!);
  assert.equal(q.get('libraryAlbumId'), '31');
  assert.equal(q.get('libraryTrackId'), '204');
  assert.equal(q.get('title'), song.title);
  assert.equal(q.get('durationMs'), '185000');
  const playlist = new URLSearchParams(
    lyricsQuery({ ...song, streamPath: '/api/playlists/stream/31' })!,
  );
  assert.equal(playlist.has('libraryTrackId'), false);
});
test('synchronized lines follow position through pauses, gaps and backwards seeks', () => {
  const lyrics = readLyrics({
    synced: true,
    lines: [
      { value: 'First', start: 1500 },
      { value: '', start: 2400 },
      { value: 'Next', start: 5000 },
    ],
  })!;
  assert.equal(lyrics.synced, true);
  assert.deepEqual(
    [0, 1800, 2400, 7000, 1500].map((p) => sungLine(lyrics.lines, p)),
    [-1, 0, 1, 2, 0],
  );
  assert.equal(readLyrics({ synced: true, lines: [{ value: 'Untimed' }] })?.synced, false);
  assert.equal(readLyrics({ synced: false, lines: [] }), null);
});
