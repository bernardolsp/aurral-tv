import assert from 'node:assert/strict';
import test from 'node:test';
import { albumArtworkPath, artworkCandidates, catalogAlbumImage, exactLibraryCover, playlistTracks, publicAlbumImage } from '../src/playlistStreams.ts';

test('playlist and flow streams select MP3 320 for capable servers and skip unplayable rows', () => {
  const done = { id: 'flow job 1', status: 'done', albumName: 'Album', durationMs: 1234 };
  const jobs = [
    {...done, streamFormat: 'flac', qualityBitrateKbps: 280},
    {...done, id:'mp3', streamFormat:'mp3', qualityBitrateKbps:192},
    {...done, id:'metadata', qualityFormat:'MP3', qualityBitrateKbps:320},
    {...done, id:'unknown', streamFormat:'mp3'},
    {...done, id:undefined}, {...done,id:''}, {...done, status: 'saved'}, {...done, status: 'pending'},
  ];
  const list = playlistTracks(jobs, true);
  assert.deepEqual(list.map(t => t.transcode), [true,false,false,true]);
  assert.equal(list[0].streamPath, '/api/playlists/stream/flow%20job%201');
  assert.equal(list[0].albumName,'Album');
  assert.equal(list[0].durationMs,1234);
  assert.ok(playlistTracks(jobs, false).every(t => !t.transcode));
});

test('track covers allow the two same-server routes and reject arbitrary URLs and routes', () => {
  const custom = '/api/playlists/track-artwork/abc?playlistId=flow&v=123';
  assert.equal(albumArtworkPath(custom), custom);
  assert.equal(albumArtworkPath('/api/artists/release-group/00000000-0000-4000-8000-000000000000/cover/image'), '/api/artists/release-group/00000000-0000-4000-8000-000000000000/cover/image');
  for (const path of ['https://elsewhere.test/a', '//other.test/a', '/api/playlists/track-artwork/..', '/api/playlists/track-artwork/x?next=https://other.test']) {
    assert.equal(albumArtworkPath(path),null);
  }
});

test('playlist jobs resolve art by exact album artist and title when no MBID is available', () => {
  const song = { id:'3x5', artist:'John Mayer', albumName:'Room for Squares', artworkPath:null };
  const lookup = 'album:["john mayer","room for squares"]';
  assert.deepEqual(artworkCandidates('Testing John Mayer', song), [lookup]);
  const path = '/api/library/albums/17/cover?v=432';
  const match = { artistName:'John Mayer', title:'Room for Squares', libraryId:'17', coverUrl:path };
  const hits = [ { ...match, artistName:'Tribute Band', libraryId:'93' }, { ...match, title:'Room for Squares (Live)', libraryId:'45' }, match ];
  assert.equal(exactLibraryCover(hits, 'JOHN  MAYER', ' Room for Squares '), path);
  assert.equal(exactLibraryCover([...hits, { ...match, libraryId:'98' }], 'John Mayer', 'Room for Squares'), null);
  assert.equal(exactLibraryCover(hits.slice(0, 2), 'John Mayer', 'Room for Squares'), null);
  assert.equal(exactLibraryCover([{...match,coverUrl:'https://foreign/album'}], song.artist, song.albumName), '/api/library/albums/17/cover');
  const custom = '/api/library/artwork/album/17?v=623';
  assert.equal(exactLibraryCover([{...match,coverUrl:custom}], song.artist, song.albumName), custom);
  const release = '/api/artists/release-group/00000000-0000-4000-8000-000000000000/cover/image';
  const olderJob = { id: '3x5', status: 'done', albumMbid: '00000000-0000-4000-8000-000000000000' };
  assert.equal(playlistTracks([olderJob], true)[0].artworkPath, release);
  assert.deepEqual(artworkCandidates('mix', {...song, artworkPath: release}), [lookup,'track:'+release]);
  assert.deepEqual(artworkCandidates('mix', {...song, artworkPath: custom}), ['track:'+custom,lookup]);
  assert.deepEqual(artworkCandidates('mix', {...song, albumName: null}), []);
  assert.deepEqual(artworkCandidates('mix'), ['collection:mix']);
});

test('credential-free cover requests constrain all redirect destinations to known public image hosts', () => {
  const base = 'https://coverartarchive.org/release-group/id/front';
  assert.equal(publicAlbumImage(base), base);
  const archive = 'https://archive.org/download/mbid-a/cover.jpg';
  assert.equal(publicAlbumImage(archive,base), archive);
  assert.equal(publicAlbumImage('//ia123.us.archive.org/1/items/mbid-abc/file.jpg',archive), 'https://ia123.us.archive.org/1/items/mbid-abc/file.jpg');
  for (const url of ['http://coverartarchive.org/release/id/front', 'https://169.254.1.1/a', '//192.168.0.1/admin','https://coverartarchive.org.evil.test/release/id', 'https://i.scdn.co:444/image/x', 'https://user:pass@i.scdn.co/image/x']) {
    assert.equal(publicAlbumImage(url,base), null);
  }
});

test('downloaded songs without a library album resolve only one matching catalog edition', () => {
  const url = 'https://cdn-images.dzcdn.net/images/cover/example/500x500.jpg';
  const hit = { artistName: 'Vespas Mandarinas', albumTitle: 'Animal Nacional (Deluxe Edition)', deezerAlbumId: '11', coverUrl: url };
  const lookup = (hits: unknown[]) => catalogAlbumImage(hits, hit.artistName, hit.albumTitle);
  assert.equal(lookup([hit, hit]), url);
  assert.equal(lookup([{...hit, albumTitle: 'Animal Nacional'}]), null);
  assert.equal(lookup([{...hit, artistName: 'Another artist'}]), null);
  assert.equal(lookup([hit, {...hit, deezerAlbumId:'22'}]), null);
  assert.equal(lookup([{...hit, coverUrl: 'http://127.0.0.1/cover'}]), null);
});
