package com.aurral.tv.audio;

import java.net.URI;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;
import okhttp3.CookieJar;
import okhttp3.OkHttpClient;

/** Only these two Aurral routes may receive the TV session and its proxy credentials. */
final class PlaybackStream {
    private static final Pattern PLAYABLE = Pattern.compile(
            "/api/(?:playlists/stream/[^/]+|library/stream/[^/]+/[^/]+)");
    static final OkHttpClient CLIENT = new OkHttpClient.Builder()
            .cookieJar(CookieJar.NO_COOKIES)
            .followRedirects(false).followSslRedirects(false)
            .connectTimeout(10, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS)
            .build();

    static String address(String server, String path, boolean transcode, long offsetMs) {
        URI base = URI.create(server);
        if (!("https".equals(base.getScheme()) || "http".equals(base.getScheme()))
                || base.getHost() == null || base.getUserInfo() != null || base.getQuery() != null
                || base.getFragment() != null || offsetMs < 0) {
            throw new IllegalArgumentException("Invalid server or playback offset.");
        }
        URI route = URI.create(path);
        String decoded = route.getPath();
        if (route.isAbsolute() || route.getRawAuthority() != null || route.getRawQuery() != null
                || route.getRawFragment() != null || decoded == null
                || !PLAYABLE.matcher(path).matches() || !PLAYABLE.matcher(decoded).matches()
                || decoded.indexOf('\\') != -1 || decoded.indexOf('?') != -1 || decoded.indexOf('#') != -1
                || decoded.chars().anyMatch(c -> c < 32 || c == 127)) {
            throw new IllegalArgumentException("Invalid server audio path.");
        }
        for (String segment : decoded.split("/")) {
            if (segment.equals(".") || segment.equals("..")) throw new IllegalArgumentException("Invalid track path.");
        }
        String result = server.replaceFirst("/+$", "") + path;
        if (!transcode) return result;
        String query = "?format=mp3&maxBitRate=320";
        return result + query + (offsetMs == 0 ? "" : "&timeOffset=" + offsetMs / 1000d);
    }

    private PlaybackStream() {}
}
