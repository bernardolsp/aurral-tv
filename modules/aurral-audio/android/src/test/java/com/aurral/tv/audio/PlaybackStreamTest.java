package com.aurral.tv.audio;

import org.junit.Test;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import static org.junit.Assert.*;

public class PlaybackStreamTest {
    private static final String SERVER = "https://music.example/prefix";
    private static final String TRACK = "/api/playlists/stream/track%201";

    @Test public void forcesMp3OnBothRoutesAndSeeksBySeconds() {
        assertEquals(SERVER + TRACK + "?format=mp3&maxBitRate=320",
                PlaybackStream.address(SERVER + "/", TRACK, true, 0));
        String library = "/api/library/stream/album%3A1/song%20A";
        assertEquals(SERVER + library + "?format=mp3&maxBitRate=320&timeOffset=15.25",
                PlaybackStream.address(SERVER, library, true, 15250));
        assertEquals(SERVER + library, PlaybackStream.address(SERVER, library, false, 0));
    }

    @Test public void refusesInjectedOriginsRoutesAndQueries() {
        for (String path : new String[]{"https://elsewhere.test/x", "//evil.test", "/api/auth/me", TRACK + "?format=raw",
                "/api/playlists/stream/%2e%2e", TRACK + "%2Fback", TRACK + "%5cname", TRACK + "#fragment"}) {
            assertThrows(IllegalArgumentException.class, () -> PlaybackStream.address(SERVER, path, true, 0));
        }
    }

    @Test public void streamsChunkedAudioWithProxyHeadersAndDeclinesRedirects() throws Exception {
        try (MockWebServer origin = new MockWebServer(); MockWebServer external = new MockWebServer()) {
            external.enqueue(new MockResponse().setBody("external"));
            origin.enqueue(new MockResponse().setHeader("Content-Type", "audio/mpeg").setChunkedBody("MP3 bytes", 3));
            origin.enqueue(new MockResponse().setResponseCode(302).setHeader("Location", external.url("/elsewhere")));
            String address = PlaybackStream.address(origin.url("/").toString(), TRACK, true, 0);
            Request request = new Request.Builder().url(address).header("Authorization", "Bearer fixture")
                    .header("Cookie", "fixture-cookie").header("X-API-Key", "fixture-proxy").build();
            try (Response response = PlaybackStream.CLIENT.newCall(request).execute()) {
                assertEquals(200, response.code());
                assertEquals(-1, response.body().contentLength());
                assertEquals("MP3 bytes", response.body().string());
            }
            RecordedRequest received = origin.takeRequest();
            assertEquals(TRACK + "?format=mp3&maxBitRate=320", received.getPath());
            assertNull(received.getHeader("Range"));
            assertEquals("Bearer fixture", received.getHeader("Authorization"));
            assertEquals("fixture-cookie", received.getHeader("Cookie"));
            assertEquals("fixture-proxy", received.getHeader("X-API-Key"));
            try (Response response = PlaybackStream.CLIENT.newCall(request).execute()) {
                assertEquals(302, response.code());
                assertEquals(0, external.getRequestCount());
            }
        }
    }
}
