package com.aurral.tv.setup;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;

/** A single-use HTTP inbox. Only the sealed envelope crosses the native bridge. */
final class LanInbox implements Closeable {
    private static final int BODY_LIMIT = 24 * 1024;
    private final ServerSocket server;
    private final InetAddress address;
    final String id;
    private final ScheduledExecutorService timer;
    private int attempts = 8;
    private Socket active;

    LanInbox(InetAddress address, String id, long ttlMillis) throws IOException {
        if (!id.matches("[a-f0-9]{32}")) throw new IOException("Invalid session");
        this.id = id;
        this.address = address;
        server = new ServerSocket();
        try {
            server.bind(new InetSocketAddress(address, 0), 1);
        } catch (IOException e) {
            server.close();
            throw e;
        }
        timer = Executors.newSingleThreadScheduledExecutor();
        timer.schedule(this::close, ttlMillis, TimeUnit.MILLISECONDS);
    }

    static boolean privateV4(InetAddress address) {
        return address instanceof Inet4Address && address.isSiteLocalAddress();
    }

    int port() { return server.getLocalPort(); }

    String next() throws IOException {
        while (!server.isClosed()) {
            synchronized (this) {
                if (attempts == 0) {
                    close();
                    throw new IOException("Pairing attempts exhausted");
                }
            }
            Socket socket = server.accept();
            synchronized (this) {
                if (server.isClosed()) {
                    socket.close();
                    break;
                }
                active = socket;
                attempts--;
            }
            try {
                socket.setSoTimeout(2500);
                // A loopback listener is used only in JVM integration tests.
                InetAddress peer = socket.getInetAddress();
                if (!privateV4(peer) && !(address.isLoopbackAddress() && peer.isLoopbackAddress())) {
                    throw new IOException("Invalid source");
                }
                return readBody(socket.getInputStream());
            } catch (IOException invalid) {
                finish(false);
            }
        }
        throw new IOException("Pairing closed");
    }

    private String readBody(InputStream input) throws IOException {
        BufferedInputStream in = new BufferedInputStream(input);
        ByteArrayOutputStream header = new ByteArrayOutputStream();
        int last = 0;
        while (last != 0x0d0a0d0a) {
            int c = in.read();
            if (c < 0 || c > 127 || header.size() >= 4096) throw new IOException("Invalid headers");
            header.write(c);
            last = (last << 8) | c;
        }
        String[] lines = header.toString("US-ASCII").split("\\r\\n");
        if (!lines[0].equals("POST /v1/setup/" + id + " HTTP/1.1")) throw new IOException("Invalid path");
        Map<String, String> headers = new HashMap<>();
        for (int index = 1; index < lines.length; index++) {
            int at = lines[index].indexOf(':');
            if (at <= 0) throw new IOException("Invalid header");
            String name = lines[index].substring(0, at).toLowerCase(Locale.ROOT);
            if (!name.matches("[a-z0-9-]+") || headers.put(name, lines[index].substring(at + 1).trim()) != null)
                throw new IOException("Invalid header");
        }
        String host = address.getHostAddress() + ":" + port();
        if (!host.equals(headers.get("host")) || headers.containsKey("transfer-encoding")
                || headers.containsKey("origin")
                || !"application/octet-stream".equalsIgnoreCase(headers.get("content-type")))
            throw new IOException("Invalid request");
        String length = headers.get("content-length");
        if (length == null || !length.matches("[1-9][0-9]{0,4}")) throw new IOException("Invalid size");
        int count = Integer.parseInt(length);
        if (count > BODY_LIMIT || count < 98) throw new IOException("Invalid size");
        byte[] body = new byte[count];
        new DataInputStream(in).readFully(body);
        String sealed = new String(body, StandardCharsets.US_ASCII);
        if (!sealed.matches("[A-Za-z0-9_-]+")) throw new IOException("Invalid envelope");
        return sealed;
    }

    synchronized boolean finish(boolean accepted) {
        if (active == null || server.isClosed()) return false;
        String status = accepted ? "204 No Content" : "400 Bad Request";
        try {
            active.getOutputStream().write(("HTTP/1.1 " + status
                + "\r\nConnection: close\r\nCache-Control: no-store\r\nContent-Length: 0\r\n\r\n")
                .getBytes(StandardCharsets.US_ASCII));
        } catch (IOException ignored) {
            // The phone may have disconnected. Do not consume another valid envelope with this key.
        } finally {
            closeQuietly(active);
            active = null;
            if (accepted || attempts == 0) close();
        }
        return true;
    }

    @Override public synchronized void close() {
        closeQuietly(server);
        closeQuietly(active);
        active = null;
        timer.shutdownNow();
    }

    private static void closeQuietly(Closeable item) {
        if (item != null) try { item.close(); } catch (IOException ignored) {}
    }
}
