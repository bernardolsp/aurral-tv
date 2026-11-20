import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { ExpiredSession, request } from './api';
import { editQueue, type Playback } from './audio';
import { serverResource, type Connection } from './connection';
import { lyricsQuery, readLyrics, sungLine, type Lyrics } from './lyrics';
import MetadataLink from './MetadataLink';
import { Artwork, Button, color } from './TvControls';

type Load = { loading: true } | { loading: false; lyrics: Lyrics | null; error?: string };
function Verse({ text, active, onSeek }: { text: string; active: boolean; onSeek?: () => void }) {
  const [focus, setFocus] = useState(false);
  const label = <Text style={[s.line, active && s.sung]}>{text || '♪'}</Text>;
  if (!onSeek) return <View style={s.verse}>{label}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={'Seek to ' + (text || 'instrumental break')}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      onPress={onSeek}
      style={[s.verse, focus && s.focus]}
    >
      {label}
    </Pressable>
  );
}

export default function LyricsScreen({
  session,
  playback,
  onOpenMetadata,
  onExpired,
}: {
  session: Connection;
  playback: Playback;
  onOpenMetadata: (kind: 'artist' | 'album') => void;
  onExpired: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const [load, setLoad] = useState<Load>({ loading: true });
  const [attempt, setAttempt] = useState(0);
  const [browseAt, setBrowseAt] = useState<number | null>(null);
  const [seekError, setSeekError] = useState('');
  const query = lyricsQuery(playback);
  useEffect(() => {
    const controller = new AbortController();
    let mounted = true;
    setLoad({ loading: true });
    async function loadLyrics() {
      if (!query) return null;
      const { uri, headers } = serverResource(session, '/api/lyrics');
      const response = await request(uri + '?' + query, headers, undefined, controller.signal);
      return readLyrics((await response.json())?.lyrics);
    }
    const timeout = setTimeout(() => controller.abort(), 20000);
    void loadLyrics()
      .then((lyrics) => {
        if (mounted) setLoad({ loading: false, lyrics });
      })
      .catch((error) => {
        if (!mounted) return;
        if (error instanceof ExpiredSession) {
          onExpired();
          return;
        }
        setLoad({
          loading: false,
          lyrics: null,
          error: controller.signal.aborted
            ? 'Lyrics lookup timed out.'
            : error instanceof Error
              ? error.message
              : 'Could not load the lyrics.',
        });
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      mounted = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [session, query, attempt, onExpired]);

  const lyrics = load.loading ? null : load.lyrics;
  const lines = lyrics?.lines ?? [];
  const active = lyrics?.synced ? sungLine(lines, playback.positionMs) : -1;
  const count = height >= 640 ? 5 : 3;
  const following = !!lyrics?.synced && browseAt === null;
  const first = Math.min(
    Math.max(0, lines.length - count),
    following ? Math.max(0, active - 1) : (browseAt ?? 0),
  );
  const last = Math.min(lines.length, first + count);
  async function seek(start: number) {
    if (!playback.sessionId || !playback.currentEntryId) return;
    setSeekError('');
    try {
      await editQueue(session, {
        action: 'seek',
        sessionId: playback.sessionId,
        entryId: playback.currentEntryId,
        positionMs: start,
      });
      setBrowseAt(null);
    } catch {
      setSeekError('The TV could not seek to this line.');
    }
  }
  return (
    <View style={s.columns}>
      <View style={s.song}>
        <Artwork
          session={session}
          id={playback.collectionId ?? 'library'}
          track={playback}
          size={Math.round(Math.min(width * 0.17, height * 0.32, 220))}
        />
        <Text numberOfLines={3} style={s.title}>
          {playback.title}
        </Text>
        <MetadataLink kind="artist" name={playback.artist} style={s.artist} onOpen={onOpenMetadata} />
        <MetadataLink kind="album" name={playback.albumName} style={s.secondary} onOpen={onOpenMetadata} />
      </View>
      <View style={s.words}>
        <Text accessibilityRole="header" style={s.heading}>
          Lyrics
        </Text>
        {load.loading ? (
          <ActivityIndicator accessibilityLabel="Loading lyrics" color={color.lime} style={s.loading} />
        ) : load.error ? (
          <View style={s.status}>
            <Text style={s.secondary}>{load.error}</Text>
            <Button label="Try again" icon="refresh" onPress={() => setAttempt((n) => n + 1)} />
          </View>
        ) : !lyrics ? (
          <Text style={s.secondary}>No lyrics found for this song.</Text>
        ) : (
          <>
            <ScrollView
              key={following ? 'follow' : first}
              style={s.list}
              contentContainerStyle={s.lines}
            >
              {lines.slice(first, last).map((line, i) => (
                <Verse
                  key={first + i}
                  text={line.value}
                  active={first + i === active}
                  onSeek={
                    lyrics.synced && !following && playback.canSeek && line.start !== undefined
                      ? () => {
                          void seek(line.start!);
                        }
                      : undefined
                  }
                />
              ))}
            </ScrollView>
            <View style={s.controls}>
              <Button
                label="Earlier"
                disabled={first === 0}
                onPress={() => setBrowseAt(Math.max(0, first - count))}
              />
              <Button label="Later" disabled={last === lines.length} onPress={() => setBrowseAt(last)} />
              {lyrics.synced && (
                <Button
                  label={following ? 'Browse lines' : 'Follow song'}
                  primary={!following}
                  onPress={() => setBrowseAt(following ? first : null)}
                />
              )}
            </View>
            {!!seekError && <Text style={s.secondary}>{seekError}</Text>}
          </>
        )}
      </View>
    </View>
  );
}
const s = StyleSheet.create({
  columns: { flex: 1, flexDirection: 'row', gap: 36, paddingTop: 24, paddingBottom: 8 },
  song: { width: '25%', gap: 8 },
  words: { flex: 1, minWidth: 0, gap: 10 },
  heading: { fontSize: 27, fontWeight: '700', color: color.ink },
  title: { fontSize: 24, fontWeight: '700', color: color.ink },
  artist: { fontSize: 18, color: color.secondary },
  secondary: { fontSize: 17, color: color.secondary },
  list: { flex: 1 },
  lines: { gap: 4, flexGrow: 1, justifyContent: 'center' },
  verse: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderWidth: 2,
    borderColor: 'transparent',
    borderRadius: 5,
  },
  focus: { borderColor: color.lime, backgroundColor: color.surface },
  line: { fontSize: 25, fontWeight: '600', color: color.secondary },
  sung: { color: color.lime, fontWeight: '800' },
  controls: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  status: { alignItems: 'flex-start', gap: 12 },
  loading: { alignSelf: 'flex-start' },
});
