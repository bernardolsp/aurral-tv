package com.aurral.tv.audio;

import org.junit.Test;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;

import java.io.IOException;
import java.util.Map;
import static org.junit.Assert.*;

public class ServerAudioSourceTest {
    @Test public void sendsExplicitCredentialsToTheStreamButNeverToARedirect() throws Exception {
        try (MockWebServer origin = new MockWebServer(); MockWebServer external = new MockWebServer()) {
            external.enqueue(new MockResponse().setBody("external"));
            origin.enqueue(new MockResponse().setResponseCode(302).setHeader("Location", external.url("/elsewhere")));
            try (ServerAudioSource stream = new ServerAudioSource(origin.url("/track").url(),
                    Map.of("Authorization", "Bearer fixture", "Cookie", "test-cookie=value", "X-API-Key", "test-proxy-value"))) {
                assertThrows(IOException.class, () -> stream.readAt(0, new byte[1], 0, 1));
                RecordedRequest request = origin.takeRequest();
                assertEquals("Bearer fixture", request.getHeader("Authorization"));
                assertEquals("test-cookie=value", request.getHeader("Cookie"));
                assertEquals("test-proxy-value", request.getHeader("X-API-Key"));
                assertEquals("bytes=0-", request.getHeader("Range"));
                assertEquals(0, external.getRequestCount());
            }
        }
    }
}
