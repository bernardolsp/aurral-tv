package com.aurral.tv.audio;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/** Confined to the playback service's main looper. Each insertion creates a new occurrence. */
final class SharedQueue {
    static final class Track {
        final String entryId = UUID.randomUUID().toString();
        final String id, title, artist, path, album, artwork;
        final boolean transcode;
        final long durationMs;
        Track(String id, String title, String artist, String path, boolean transcode,
              long durationMs, String album, String artwork) {
            this.id = id; this.title = title; this.artist = artist;
            this.path = path; this.transcode = transcode; this.durationMs = durationMs;
            this.album = album; this.artwork = artwork;
        }
    }

    private final List<Track> order = new ArrayList<>();
    private final List<Track> original = new ArrayList<>();
    private final Set<String> pinned = new HashSet<>();
    private List<Track> continuation = Collections.emptyList();
    String sessionId, flowId, flowName, collectionId;
    int index = -1;
    long revision;
    boolean shuffle;

    void replace(String collection, List<Track> items, int start) {
        require(start >= 0 && start < items.size());
        clear();
        sessionId = UUID.randomUUID().toString();
        collectionId = collection;
        order.addAll(items);
        original.addAll(items);
        index = start;
    }
    void clear() {
        sessionId = collectionId = flowId = flowName = null;
        index = -1;
        shuffle = false;
        order.clear(); original.clear(); pinned.clear();
        continuation = Collections.emptyList();
        revision++;
    }
    void checkSession(String expected) { require(sessionId != null && sessionId.equals(expected)); }
    Track current() { return index < 0 ? null : order.get(index); }
    boolean canSkip(int step) { return index >= 0 && index + step >= 0 && index + step < order.size(); }
    List<Track> entries() { return Collections.unmodifiableList(order); }
    boolean isPinned(Track t) { return pinned.contains(t.entryId); }
    List<Track> upcoming() {
        if (current() == null) return Collections.emptyList();
        return order.subList(index + 1, Math.min(index + 9, order.size()));
    }
    private int location(String id) {
        for (int i = 0; i < order.size(); i++) if (order.get(i).entryId.equals(id)) return i;
        throw new IllegalArgumentException("Queue entry has changed.");
    }
    private int future(String id) {
        int at = location(id);
        require(at > index);
        return at;
    }
    private static void require(boolean value) {
        if (!value) throw new IllegalArgumentException("The TV queue has changed.");
    }
    void goTo(int target) {
        require(target >= 0 && target < order.size());
        index = target;
        // A pinned entry ceases to be pending once playback passes it.
        for (int i = 0; !pinned.isEmpty() && i <= index; i++) pinned.remove(order.get(i).entryId);
        revision++;
    }
    void jump(String id) { goTo(location(id)); }
    void move(String id, String beforeId) {
        int from = future(id);
        Track anchor = beforeId == null ? null : order.get(future(beforeId));
        Track track = order.get(from);
        if (track == anchor) return;
        pinned.remove(id);
        order.remove(from);
        order.add(anchor == null ? order.size() : order.indexOf(anchor), track);
        original.remove(track);
        original.add(anchor == null ? original.size() : original.indexOf(anchor), track);
        revision++;
    }
    void remove(String id) {
        Track track = order.remove(future(id));
        original.remove(track); pinned.remove(id);
        revision++;
    }
    void pin(String id) {
        Track track = order.remove(future(id));
        order.add(index + 1, track);
        original.remove(track);
        original.add(original.indexOf(current()) + 1, track);
        pinned.add(id);
        revision++;
    }
    void append(List<Track> items, boolean next) {
        require(!items.isEmpty() && current() != null);
        if (next) {
            for (Track track : items) pinned.add(track.entryId);
            order.addAll(index + 1, items);
            original.addAll(original.indexOf(current()) + 1, items);
        } else {
            order.addAll(items);
            original.addAll(items);
        }
        revision++;
    }
    void setShuffle(boolean enabled) {
        if (shuffle == enabled) return;
        List<Track> tail = order.subList(index + 1, order.size());
        List<Track> held = new ArrayList<>(), others = new ArrayList<>();
        Set<Track> remaining = new HashSet<>(tail);
        for (Track t : tail) if (isPinned(t)) held.add(t);
        for (Track t : original) if (remaining.contains(t) && !isPinned(t)) others.add(t);
        if (enabled) Collections.shuffle(others);
        tail.clear(); tail.addAll(held); tail.addAll(others);
        shuffle = enabled;
        revision++;
    }
    void setFlow(String id, String name, List<Track> tracks) {
        require(id == null || !tracks.isEmpty());
        flowId = id; flowName = name; continuation = new ArrayList<>(tracks);
        revision++;
    }
    boolean advance() {
        if (!canSkip(1) && flowId != null) {
            order.addAll(continuation);
            original.addAll(continuation);
            collectionId = flowId;
            flowId = flowName = null;
            continuation = Collections.emptyList();
        }
        if (!canSkip(1)) return false;
        goTo(index + 1);
        return true;
    }
}
