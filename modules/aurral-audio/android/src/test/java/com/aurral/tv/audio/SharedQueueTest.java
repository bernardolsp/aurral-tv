package com.aurral.tv.audio;

import org.junit.Test;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import static org.junit.Assert.*;
import com.aurral.tv.audio.SharedQueue.Track;

public class SharedQueueTest {
    final SharedQueue q = new SharedQueue();
    final Track first = track("1"), second = track("same"), third = track("same"), last = track("4");
    private static Track track(String id) {
        return new Track(id, id, "artist", "/api/playlists/stream/" + id, true, 60000, null, null);
    }
    public SharedQueueTest() { q.replace("playlist", Arrays.asList(first, second, third, last), 0); }

    @Test public void stableEntriesSurviveNaturalAdvanceAndDuplicateTrackIds() {
        assertNotEquals(second.entryId, third.entryId);
        assertTrue(q.advance());
        long revision = q.revision;
        q.move(last.entryId, third.entryId);
        assertSame(second, q.current());
        assertEquals(Arrays.asList(first, second, last, third), q.entries());
        assertTrue(q.revision > revision);
        assertThrows(IllegalArgumentException.class, () -> q.remove(second.entryId));
        assertThrows(IllegalArgumentException.class, () -> q.move(last.entryId, first.entryId));
        q.remove(third.entryId);
        assertTrue(q.advance());
        assertSame(last, q.current());
        assertFalse(q.advance());
    }

    @Test public void shufflePreservesHistoryAndPinsAndOnlyRestoresUnplayedEntries() {
        q.advance();
        q.pin(last.entryId);
        q.setShuffle(true);
        assertSame(second, q.current());
        assertSame(last, q.upcoming().get(0));
        Track extra = track("e");
        q.append(Collections.singletonList(extra), true);
        assertEquals(Arrays.asList(extra, last, third), q.upcoming());
        q.advance();
        assertFalse(q.isPinned(extra));
        q.setShuffle(false);
        assertSame(extra, q.current());
        assertEquals(Arrays.asList(last, third), q.upcoming());
        assertEquals(5, new HashSet<>(q.entries()).size());
    }

    @Test public void explicitPlayNextAndMovesRemainPossibleDuringShuffle() {
        q.setShuffle(true);
        Track added = track("new");
        q.append(Collections.singletonList(added), true);
        q.move(added.entryId, null);
        assertFalse(q.isPinned(added));
        assertSame(added, q.entries().get(q.entries().size() - 1));
        q.setShuffle(false);
        assertEquals(Arrays.asList(first, second, third, last, added), q.entries());
        assertSame(first, q.current());
    }

    @Test public void flowStartsOnceAfterManualItemsAndReplacementRevokesItsSelection() {
        Track flow = track("flow");
        q.setFlow("flow-id", "My Flow", Collections.singletonList(flow));
        q.jump(last.entryId);
        Track encore = track("encore");
        q.append(Collections.singletonList(encore), false);
        q.advance();
        assertSame(encore, q.current());
        assertTrue(q.advance());
        assertSame(flow, q.current());
        assertEquals("flow-id", q.collectionId);
        assertNull(q.flowId);
        assertFalse(q.advance());
        String oldSession = q.sessionId;
        q.setFlow("flow-id", "My Flow", Collections.singletonList(track("other")));
        q.replace("other", Collections.singletonList(first), 0);
        assertThrows(IllegalArgumentException.class, () -> q.checkSession(oldSession));
        assertFalse(q.advance());
        assertNull(q.flowName);
    }
}
