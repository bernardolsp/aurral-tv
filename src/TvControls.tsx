import React, { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import * as api from './api';
import { artworkCandidates, type CoverTrack } from './playlistStreams';
import type { Connection } from './connection';
import { createCoverCache } from './coverCache';

export const color = {
  bg: '#10130f',
  surface: '#20261f',
  raised: '#2e352b',
  border: '#3d463a',
  ink: '#f5f7f1',
  secondary: '#c0c8b9',
  muted: '#a4b09e',
  lime: '#b3e66b',
  dark: '#16200e',
  error: '#ffc09a',
};

const paths = {
  back: 'M15 5l-7 7 7 7',
  refresh: 'M20 7v5h-5 M19.3 12a7.3 7.3 0 1 1-2-5.3L20 9',
  library: 'M3 4v16 M7 4v16 M11 4v16 M15 5l5 14',
  lyrics: 'M4 5h16v12H9l-5 4z M8 9h8 M8 13h5',
  disconnect: 'M9 4H5v16h4 M10 12h10 M16 8l4 4-4 4',
  play: 'M8 4.5L20 12 8 19.5z',
  pause: 'M7 5v14 M16 5v14',
  previous: 'M5 5v14 M19 5l-10 7 10 7z',
  next: 'M19 5v14 M5 5l10 7-10 7z',
  sound: 'M4 11v3 M8 6v13 M12 3v18 M16 8v9 M20 10v4',
  phone: 'M7 3h10v18H7z M11 17h2',
  code: 'M4 7h16v11H4z M7 11h1 M11 11h1 M15 11h1 M9 14h6',
  queue: 'M3 6h16 M3 11h16 M3 16h8 M15 14l5 3-5 3z',
  shuffle: 'M3 6h3c5 0 6 12 12 12h3 M17 14l4 4-4 4 M3 18h3c2 0 4-3 5-5 M14 8c1-1 2-2 4-2h3 M17 2l4 4-4 4',
  flow: 'M2 13h3c2 0 2-7 4-7s2 12 5 12 2-8 5-8h3',
  up: 'M5 14l7-7 7 7',
  down: 'M5 10l7 7 7-7',
  remove: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13 M10 11v5 M14 11v5',
  check: 'M4 12l5 5L20 6',
  settings: 'M4 7h3 M11 7h9 M4 17h9 M17 17h3 M7 4h4v6H7z M13 14h4v6h-4z',
} as const;
export type IconName = keyof typeof paths;
export function Icon({ name, size = 19, tint = color.ink }: { name: IconName; size?: number; tint?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
      <Path
        d={paths[name]}
        fill={['play', 'previous', 'next'].includes(name) ? tint : 'none'}
        stroke={tint}
        strokeWidth={name === 'pause' ? 4.5 : 1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function Brand() {
  return (
    <View style={s.brand} accessible accessibilityLabel="Aurral TV">
      <Image source={require('../assets/brand.png')} resizeMode="contain" style={s.brandMark} />
      <Text style={s.brandText}>Aurral TV</Text>
    </View>
  );
}

export function Button({
  label,
  onPress,
  icon,
  preferred,
  primary,
  iconOnly,
  nextFocusDown,
  focusRef,
  disabled,
}: {
  label: string;
  onPress: () => void;
  icon?: IconName;
  preferred?: boolean;
  primary?: boolean;
  iconOnly?: boolean;
  nextFocusDown?: number;
  focusRef?: React.Ref<React.ComponentRef<typeof Pressable>>;
  disabled?: boolean;
}) {
  const [focus, setFocus] = useState(false);
  const tint = primary && !focus ? color.dark : color.ink;
  return (
    <Pressable
      ref={focusRef}
      accessibilityRole="button"
      accessibilityLabel={label}
      hasTVPreferredFocus={preferred}
      nextFocusDown={nextFocusDown}
      disabled={disabled}
      focusable={!disabled}
      onPress={onPress}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      style={[
        s.button,
        iconOnly && s.iconButton,
        primary && s.primary,
        focus && s.focus,
        disabled && s.disabled,
      ]}
    >
      {icon && <Icon name={icon} tint={tint} size={iconOnly ? (primary ? 31 : 23) : 17} />}
      {!iconOnly && (
        <Text numberOfLines={1} style={[s.buttonText, { color: tint }]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const palettes = [
  ['#c4b6f0', '#564784', '#302c50'],
  ['#f1a482', '#aa4938', '#612c32'],
  ['#a7dcb1', '#44806c', '#244847'],
  ['#9ebcef', '#456b9b', '#313b64'],
  ['#dfcf81', '#8a7441', '#554c2d'],
  ['#e4acd5', '#9e598d', '#5a375c'],
] as const;
function palette(id: string) {
  let hash = 0;
  for (const ch of id) hash = (Math.imul(hash, 31) + ch.charCodeAt(0)) | 0;
  return palettes[(hash >>> 0) % palettes.length];
}

export function Sleeve({ id, flow = false }: { id: string; flow?: boolean }) {
  const [light, middle, dark] = palette(id);
  return (
    <Svg
      width="100%"
      height="100%"
      viewBox="0 0 128 128"
      preserveAspectRatio="xMidYMid slice"
      accessible={false}
    >
      <Rect width={128} height={128} fill={dark} />
      {flow ? (
        <>
          <Path d="M0 0h128v28Q87 5 49 57T0 110z" fill={middle} />
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <Path
              key={i}
              d="M-12 108Q17 120 54 65T143 38"
              transform={`translate(0 ${i * 6 - 22})`}
              fill="none"
              stroke={light}
              strokeWidth={2.2}
            />
          ))}
        </>
      ) : (
        <>
          <Path d="M0 0h128L0 128z" fill={middle} />
          <Circle cx={98} cy={83} r={59} fill={dark} />
          {[49, 41, 33].map((r) => (
            <Circle key={r} cx={98} cy={83} r={r} stroke={light} opacity={0.6} fill="none" strokeWidth={1.3} />
          ))}
          <Circle cx={98} cy={83} r={19} fill={light} />
          <Circle cx={98} cy={83} r={3} fill={dark} />
          <Path d="M-6 48L62 -6h15L-6 63z" fill={light} opacity={0.85} />
        </>
      )}
    </Svg>
  );
}

const caches = new WeakMap<Connection, ReturnType<typeof createCoverCache>>();
export function Artwork({
  session,
  id,
  flow,
  size,
  track,
  backdrop,
  hideMissing,
  fitHeight,
  entityArtworkPath,
  artworkFallbackLabel,
}: {
  session: Connection;
  id: string;
  flow?: boolean;
  size: number;
  track?: CoverTrack;
  backdrop?: boolean;
  hideMissing?: boolean;
  fitHeight?: boolean;
  entityArtworkPath?: string | null;
  artworkFallbackLabel?: string;
}) {
  const candidates = entityArtworkPath === undefined ? artworkCandidates(id, track) :
    (entityArtworkPath ? ['entity:' + entityArtworkPath] : []);
  const identity = JSON.stringify(candidates);
  const [loaded, setLoaded] = useState<{session: Connection; identity: string; uri: string; next: () => void} | null>(null);
  useEffect(() => {
    let cache = caches.get(session);
    if (!cache) {
      cache = createCoverCache(session, (connection, resource, signal) => {
        if (resource.startsWith('album:')) {
          const [artist, album] = JSON.parse(resource.slice(6)) as [string, string];
          return api.libraryAlbumCover(connection, artist, album, signal);
        }
        if (resource.startsWith('entity:')) return api.libraryEntityCover(connection, resource.slice(7), signal);
        if (resource.startsWith('track:')) return api.trackCover(connection, resource.slice(6), signal);
        return api.cover(connection, resource.slice(11), signal);
      });
      caches.set(session, cache);
    }
    const store = cache;
    const candidates: string[] = JSON.parse(identity);
    const releases: (() => void)[] = [];
    let mounted = true;
    let index = 0;
    function next() {
      if (!mounted) return;
      setLoaded(null);
      const candidate = candidates[index++];
      if (!candidate) return;
      releases.push(store.subscribe(candidate, uri => {
        if (!mounted) return;
        if (uri) setLoaded({session, identity, uri, next});
        else next();
      }));
    }
    next();
    return () => { mounted = false; releases.forEach(release => release()); };
  }, [session, identity]);
  const image = loaded?.session === session && loaded.identity === identity ? loaded : null;
  const sleeve = track ? (track.albumName ? track.artist + ':' + track.albumName : track.id || 'song') : id;
  if (hideMissing && !image) return null;
  const initials = (artworkFallbackLabel || track?.artist || track?.albumName || '♪').trim().split(/\s+/u).slice(0, 2)
    .map(word => Array.from(word)[0]).join('').toUpperCase();
  return (
    <View style={backdrop ? [StyleSheet.absoluteFill, { backgroundColor: palette(sleeve)[2] }] :
      [s.cover, fitHeight ? { height: '100%', maxHeight: size, maxWidth: size, aspectRatio: 1 } :
        { width: size, height: size }]} accessible={false}>
      {!backdrop && (track || entityArtworkPath !== undefined ?
        <View style={[s.monogram, { backgroundColor: palette(sleeve)[2] }]}>
          <Text style={{color: palette(sleeve)[0], fontSize: size * 0.34, fontWeight: '700'}}>{initials}</Text>
        </View> : <Sleeve id={sleeve} flow={flow} />)}
      {image && (
        <Image
          source={{ uri: image.uri }}
          style={s.image}
          resizeMode="cover"
          blurRadius={backdrop ? 4 : 0}
          onError={image.next}
          onLoad={({ nativeEvent: { source } }) => {
            if (source.width === 1 && source.height === 1) image.next();
          }}
        />
      )}
    </View>
  );
}

export function timeLabel(ms: number) {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const seconds = String(total % 60).padStart(2, '0');
  const minutes = Math.floor(total / 60);
  return minutes >= 60
    ? Math.floor(minutes / 60) + ':' + String(minutes % 60).padStart(2, '0') + ':' + seconds
    : minutes + ':' + seconds;
}

const s = StyleSheet.create({
  brand: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  brandMark: { width: 34, height: 34 },
  brandText: { fontSize: 22, fontWeight: '700', letterSpacing: -0.7, color: color.ink },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: 6,
    paddingHorizontal: 14,
    minHeight: 39,
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: 'transparent',
  },
  iconButton: { width: 48, height: 48, borderRadius: 30, paddingHorizontal: 0 },
  buttonText: { fontSize: 15, fontWeight: '600' },
  primary: { backgroundColor: color.ink },
  focus: { borderColor: color.lime, backgroundColor: color.raised },
  disabled: { opacity: 0.4 },
  cover: { borderRadius: 3, overflow: 'hidden', backgroundColor: color.surface },
  monogram: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  image: { position: 'absolute', width: '100%', height: '100%' },
});
