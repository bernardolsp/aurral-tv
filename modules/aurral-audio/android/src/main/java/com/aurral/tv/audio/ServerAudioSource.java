package com.aurral.tv.audio;

import android.media.MediaDataSource;
import java.io.IOException;
import java.io.InputStream;
import java.net.URL;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import okhttp3.CookieJar;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

/** The platform decoder reads ranges; credentials go only to the exact URL supplied by the app. */
final class ServerAudioSource extends MediaDataSource {
    private static final OkHttpClient CLIENT = new OkHttpClient.Builder()
            .cookieJar(CookieJar.NO_COOKIES)
            .followRedirects(false)
            .followSslRedirects(false)
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(15, TimeUnit.SECONDS)
            .build();
    private final URL url;
    private final Map<String, String> headers;
    private Response response;
    private InputStream input;
    private long cursor, size = -1;
    private boolean closed;

    ServerAudioSource(URL url, Map<String, String> headers) { this.url = url; this.headers = headers; }

    @Override public synchronized int readAt(long position, byte[] buffer, int offset, int count) throws IOException {
        if (count == 0) return 0;
        if (closed || (size >= 0 && position >= size)) return -1;
        if (input == null || cursor != position) open(position);
        if (input == null) return -1;
        int n = input.read(buffer, offset, count);
        if (n > 0) cursor += n;
        return n;
    }

    private void open(long position) throws IOException {
        disconnect();
        Request.Builder request = new Request.Builder().url(url);
        for (Map.Entry<String, String> header : headers.entrySet()) request.header(header.getKey(), header.getValue());
        request.header("Range", "bytes=" + position + "-").header("Accept-Encoding", "identity");
        response = CLIENT.newCall(request.build()).execute();
        int status = response.code();
        if (status == 416) { disconnect(); return; }
        if (status != 200 && status != 206) throw new IOException("Stream returned HTTP " + status);
        if (position != 0 && status != 206) throw new IOException("The server does not support seeking.");
        if (status == 200) size = response.body().contentLength();
        else {
            String range = response.header("Content-Range");
            if (range == null || !range.startsWith("bytes " + position + "-")) throw new IOException("Unexpected stream range.");
            String total = range.substring(range.lastIndexOf('/') + 1);
            if (!total.equals("*")) {
                try { size = Long.parseLong(total); }
                catch (NumberFormatException e) { throw new IOException("Invalid stream size.", e); }
            }
        }
        input = response.body().byteStream();
        cursor = position;
    }

    private void disconnect() {
        if (response != null) response.close();
        response = null;
        input = null;
    }
    @Override public synchronized long getSize() throws IOException {
        if (!closed && input == null && size < 0) open(0);
        return size;
    }
    @Override public synchronized void close() throws IOException { closed = true; disconnect(); }
}
