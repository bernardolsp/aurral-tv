import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { audio, editQueue, type Playback, type QueueEdit, type QueueEntry, type QueueSnapshot } from './audio';
import { collections, type Collection } from './api';
import type { Connection } from './connection';
import { Artwork, Button, Icon, color, timeLabel } from './TvControls';

type FocusTarget = React.ComponentRef<typeof Pressable>;
const rowHeight = 58;
const rowLayout = (_: unknown, index: number) => ({ index, length: rowHeight, offset: index * rowHeight });

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Could not update the queue.';
}

function QueueRow({ item, index, current, selected, preferred, onFocus, onPress }: {
  item: QueueEntry;
  index: number;
  current: boolean;
  selected: boolean;
  preferred: boolean;
  onFocus: () => void;
  onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[item.title, item.artist, current ? 'Now playing' : item.pinned ? 'Play next' : ''].filter(Boolean).join(', ')}
      accessibilityHint="Select to open song actions"
      hasTVPreferredFocus={preferred}
      onFocus={() => { setFocused(true); onFocus(); }}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={[s.row, selected && s.rowSelected, focused && s.rowFocused]}
    >
      <View style={s.ordinal}>
        {current ? <Icon name="sound" tint={color.lime} /> : <Text style={s.metadata}>{index + 1}</Text>}
      </View>
      <View style={s.trackCopy}>
        <Text numberOfLines={1} style={[s.trackTitle, current && s.current]}>{item.title || 'Unknown title'}</Text>
        <Text numberOfLines={1} style={s.metadata}>{item.artist}</Text>
      </View>
      {item.pinned && <Icon name="next" tint={color.lime} size={16} />}
      {item.durationMs != null && <Text style={s.metadata}>{timeLabel(item.durationMs)}</Text>}
    </Pressable>
  );
}

function QueueContents({ session, snapshot, onOpenFlows, onChange, error, busy }: {
  session: Connection;
  snapshot: QueueSnapshot;
  onOpenFlows: () => void;
  onChange: (edit: QueueEdit) => void;
  error: string;
  busy: boolean;
}) {
  const { entries, sessionId, index: current, shuffle, flowName } = snapshot;
  const [firstId] = useState(() => entries[current + 1]?.entryId ?? snapshot.currentEntryId);
  const [selectedId, setSelectedId] = useState(firstId);
  const selectedIndex = entries.findIndex(item => item.entryId === selectedId);
  const selected = entries[selectedIndex];
  const upcoming = selectedIndex > current;
  const actionButton = useRef<FocusTarget | null>(null);
  const [listSize, setListSize] = useState<{width: number; height: number} | null>(null);
  const initialIndex = useRef(Math.max(0, entries.findIndex(song => song.entryId === firstId)));
  const remaining = Math.max(0, entries.length - current - 1);
  const title = selected?.title || 'Unknown title';

  function forSelected(action: 'jump' | 'pin' | 'remove') {
    if (sessionId && selected) onChange({ sessionId, action, entryId: selected.entryId });
  }
  function move(direction: -1 | 1) {
    if (!sessionId || !upcoming || selectedIndex + direction <= current || selectedIndex + direction >= entries.length) return;
    // Moving down means inserting before the entry after our neighbor, or appending.
    const before = entries[selectedIndex + (direction < 0 ? -1 : 2)];
    onChange({ sessionId, action: 'move', entryId: selected.entryId, beforeEntryId: before?.entryId ?? null });
  }
  return (
    <View style={s.screen}>
      <View style={s.toolbar}>
        <View style={s.headingGroup}>
          <Text accessibilityRole="header" style={s.heading}>Play queue</Text>
          <Text style={s.metadata}>{remaining} upcoming</Text>
        </View>
        <Button
          label={shuffle ? 'Shuffle on' : 'Shuffle off'} icon="shuffle" primary={shuffle}
          disabled={busy || !sessionId}
          onPress={() => { if (sessionId) onChange({ sessionId, action: 'shuffle', enabled: !shuffle }); }}
        />
        <Button label="Choose Flow" icon="flow" disabled={busy || !sessionId} onPress={onOpenFlows} />
      </View>
      {flowName && <Text numberOfLines={1} style={s.flowSummary}>After this queue · {flowName}</Text>}
      {!!error && <Text accessibilityLiveRegion="polite" style={s.error}>{error}</Text>}
      <View style={s.columns}>
        <View style={s.listColumn} onLayout={({nativeEvent: {layout: {width, height}}}) => {
          if (width > 0 && height > 0)
            setListSize(previous => previous?.width === width && previous.height === height ? previous : {width, height});
        }}>
          {listSize && (
          <FlatList
          style={listSize}
          data={entries}
          extraData={selectedId}
          keyExtractor={item => item.entryId}
          getItemLayout={rowLayout}
          initialScrollIndex={initialIndex.current || undefined}
          initialNumToRender={10}
          renderItem={({ item, index }) => (
            <QueueRow
              item={item} index={index} current={index === current} selected={item.entryId === selectedId}
              preferred={item.entryId === firstId}
              onFocus={() => setSelectedId(item.entryId)}
              onPress={() => {
                setSelectedId(item.entryId);
                const target = actionButton.current as (FocusTarget & { requestTVFocus?: () => void }) | null;
                if (target?.requestTVFocus) target.requestTVFocus();
                else target?.focus();
              }}
            />
          )}
          />)}
        </View>
        <View style={s.details}>
          {selected ? (
            <>
              <View style={s.selection}>
                <Artwork session={session} id={snapshot.collectionId ?? 'pocket-queue'} size={56} track={selected} />
                <View style={s.trackCopy}>
                  <Text numberOfLines={2} style={s.trackTitle}>{title}</Text>
                  <Text numberOfLines={1} style={s.metadata}>
                    {selectedIndex === current ? 'Now playing' : selected.pinned ? 'Pinned to play next' : selected.artist}
                  </Text>
                </View>
              </View>
              <Button
                focusRef={actionButton} disabled={busy}
                label={selectedIndex === current ? snapshot.playing ? 'Pause' : 'Resume' : 'Play now'}
                icon={selectedIndex === current && snapshot.playing ? 'pause' : 'play'}
                onPress={() => {
                  if (selectedIndex === current && sessionId) {
                    onChange({ sessionId, action: snapshot.playing ? 'pause' : 'resume' });
                  } else forSelected('jump');
                }}
              />
              {upcoming && (
                <>
                  <Button label="Play next" icon="next" disabled={busy} onPress={() => forSelected('pin')} />
                  <View style={s.moveControls}>
                    <Button label="Move up" icon="up" disabled={busy || selectedIndex === current + 1} onPress={() => move(-1)} />
                    <Button label="Move down" icon="down" disabled={busy || selectedIndex === entries.length - 1} onPress={() => move(1)} />
                  </View>
                  <Button label="Remove" icon="remove" disabled={busy} onPress={() => forSelected('remove')} />
                </>
              )}
            </>
          ) : <Text style={s.metadata}>Choose a song to see its controls.</Text>}
        </View>
      </View>
    </View>
  );
}

export function QueueScreen({ session, playback, onOpenFlows }: {
  session: Connection;
  playback: Playback;
  onOpenFlows: () => void;
}) {
  const [snapshot, setSnapshot] = useState<QueueSnapshot | null>(null);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const editing = useRef(false);
  useEffect(() => {
    let active = true;
    void audio.queueState().then(state => { if (active) setSnapshot(state); })
      .catch(e => { if (active) setError(errorMessage(e)); });
    return () => { active = false; };
  }, [playback.sessionId, playback.revision, playback.currentEntryId, playback.playing, reload]);
  async function change(edit: QueueEdit) {
    if (editing.current) return;
    editing.current = true;
    setBusy(true);
    setError('');
    try {
      await editQueue(session, edit);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      editing.current = false;
      setBusy(false);
      setReload(value => value + 1);
    }
  }
  if (!snapshot || snapshot.sessionId !== playback.sessionId) {
    return <View style={s.center}>{error ? <>
      <Text accessibilityLiveRegion="polite" style={s.error}>{error}</Text>
      <Button preferred icon="refresh" label="Retry" onPress={() => { setError(''); setReload(value => value + 1); }} />
    </> : <ActivityIndicator accessibilityLabel="Loading queue" color={color.lime} />}</View>;
  }
  return <QueueContents key={snapshot.sessionId} session={session} snapshot={snapshot} busy={busy} error={error}
    onChange={edit => { void change(edit); }} onOpenFlows={onOpenFlows} />;
}

export function FlowPicker({ session, playback, onDone }: {
  session: Connection;
  playback: Playback;
  onDone: () => void;
}) {
  const [flows, setFlows] = useState<Collection[] | null>(null);
  const [reload, setReload] = useState(0);
  const [loadError, setLoadError] = useState('');
  const [editError, setEditError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    let active = true;
    setLoadError('');
    void collections(session).then(items => { if (active) setFlows(items.filter(item => item.kind === 'Flow')); })
      .catch(e => { if (active) setLoadError(errorMessage(e)); });
    return () => { active = false; };
  }, [session, reload]);
  async function choose(flowId: string | null) {
    if (!playback.sessionId || pending.current) return;
    pending.current = true;
    setBusy(true);
    setEditError('');
    try {
      await editQueue(session, { sessionId: playback.sessionId, action: 'flow', flowId });
      if (mounted.current) onDone();
    } catch (e) {
      if (mounted.current) setEditError(errorMessage(e));
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const options = [{ id: null, name: 'Stop after this queue' }, ...(flows ?? [])];
  const picked = options.findIndex(option => option.id === playback.flowId);
  return (
    <View style={s.screen}>
      <Text accessibilityRole="header" style={s.heading}>After this queue</Text>
      <Text style={s.metadata}>Choose a Flow to play when the last song ends.</Text>
      {!!editError && <Text accessibilityLiveRegion="polite" style={s.error}>{editError}</Text>}
      {busy && <Text accessibilityLiveRegion="polite" style={s.metadata}>Updating queue…</Text>}
      {!!loadError && <View style={s.loadError}><Text style={s.error}>{loadError}</Text>
        <Button label="Reload Flows" icon="refresh" onPress={() => setReload(value => value + 1)} /></View>}
      {flows === null && !loadError ? <ActivityIndicator accessibilityLabel="Loading Flows" color={color.lime} /> :
        <FlatList
          keyExtractor={item => item.id ?? 'continuation-off'}
          data={options}
          initialScrollIndex={picked > 0 ? picked : undefined}
          getItemLayout={rowLayout}
          ListFooterComponent={flows?.length === 0 ? <Text style={s.metadata}>No saved Flows yet.</Text> : undefined}
          renderItem={({item, index}) => (
            <FlowRow name={item.name} chosen={playback.flowId === item.id} preferred={index === Math.max(0, picked)}
              disabled={busy} onPress={() => { void choose(item.id); }} />
          )}
        />}
    </View>
  );
}

function FlowRow({ name, chosen, preferred, disabled, onPress }: {
  name: string; chosen: boolean; preferred: boolean; disabled: boolean; onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{checked: chosen, disabled}}
      hasTVPreferredFocus={preferred} disabled={disabled} onPress={onPress}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} style={[s.row, focused && s.rowFocused]}>
      <View style={s.ordinal}>{chosen && <Icon name="check" tint={color.lime} />}</View>
      <Text numberOfLines={1} style={[s.trackTitle, chosen && s.current]}>{name}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, paddingTop: 12, gap: 8 },
  toolbar: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  headingGroup: { flex: 1, flexDirection: 'row', alignItems: 'baseline', gap: 11 },
  heading: { color: color.ink, fontSize: 28, fontWeight: '700', letterSpacing: -0.7 },
  metadata: { color: color.muted, fontSize: 15, fontVariant: ['tabular-nums'] },
  flowSummary: { color: color.secondary, fontSize: 15 },
  columns: { flex: 1, width: '100%', flexDirection: 'row', gap: 18, minHeight: 0 },
  listColumn: { flex: 1, minWidth: 0 },
  details: { width: '34%', flexShrink: 0, paddingHorizontal: 12, gap: 7, alignItems: 'flex-start' },
  ordinal: { width: 24, alignItems: 'center' },
  trackCopy: { flex: 1, gap: 1 },
  trackTitle: { color: color.ink, fontSize: 17, fontWeight: '600' },
  selection: { flexDirection: 'row', width: '100%', alignItems: 'center', gap: 10, marginBottom: 2 },
  moveControls: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  current: { color: color.lime },
  row: { width: '100%', height: rowHeight, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 10,
    borderWidth: 2, borderColor: 'transparent', borderRadius: 8 },
  rowSelected: { backgroundColor: color.surface },
  rowFocused: { borderColor: color.lime, backgroundColor: color.raised },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  error: { color: color.error, fontSize: 15 },
  loadError: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
