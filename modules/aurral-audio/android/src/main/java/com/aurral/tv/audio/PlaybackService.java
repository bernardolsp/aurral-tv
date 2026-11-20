package com.aurral.tv.audio;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Binder;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.DataSpec;
import androidx.media3.datasource.TransferListener;
import androidx.media3.datasource.okhttp.OkHttpDataSource;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.ProgressiveMediaSource;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import okhttp3.Call;
import okhttp3.EventListener;
import okhttp3.OkHttpClient;
import okhttp3.Response;

public final class PlaybackService extends Service {
    private static final String CHANNEL = "playback", LOG = "AurralPlayback";
    private static final int NOTICE = 1;
    final class LocalBinder extends Binder { PlaybackService service() { return PlaybackService.this; } }
    private final LocalBinder binder = new LocalBinder();
    private final Handler main = new Handler(Looper.getMainLooper());
    private MediaSession session;
    private ExoPlayer player;
    private String server, collection;
    private Map<String, String> headers = Collections.emptyMap();

    static final class Track {
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
    private List<Track> tracks = Collections.emptyList();
    private int index;
    private long startAtMs, started;
    private AtomicLong received = new AtomicLong();
    private boolean preparing;
    private String error = "";
    Runnable listener;

    private final Runnable progress = new Runnable() {
        @Override public void run() {
            if (listener != null && player != null && player.isPlaying()) {
                listener.run();
                main.postDelayed(this, 1000);
            }
        }
    };

    @Override public IBinder onBind(Intent intent) { return binder; }
    @Override public int onStartCommand(Intent intent, int flags, int startId) { return START_NOT_STICKY; }

    @Override public void onCreate() {
        super.onCreate();
        getSystemService(NotificationManager.class).createNotificationChannel(
                new NotificationChannel(CHANNEL, "Playback", NotificationManager.IMPORTANCE_LOW));
        session = new MediaSession(this, "Aurral TV");
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { resume(); }
            @Override public void onPause() { pause(); }
            @Override public void onSeekTo(long ms) { seek(ms); }
            @Override public void onSkipToNext() { skip(1); }
            @Override public void onSkipToPrevious() { skip(-1); }
            @Override public void onStop() { clear(); }
        });
    }

    Track current() { return tracks.isEmpty() ? null : tracks.get(index); }
    String collectionId() { return collection; }
    boolean isPlaying() {
        return player != null && error.isEmpty() && player.getPlayWhenReady()
                && player.getPlaybackState() != Player.STATE_ENDED;
    }
    boolean buffering() { return player != null && player.getPlaybackState() == Player.STATE_BUFFERING; }
    String message() { return error; }
    boolean canSkip(int step) { return index + step >= 0 && index + step < tracks.size(); }
    List<Track> upcoming() {
        if (tracks.isEmpty()) return Collections.emptyList();
        return tracks.subList(index + 1, Math.min(index + 9, tracks.size()));
    }
    void playUpcoming(String currentId, String selectedId) {
        if (current() == null || !current().id.equals(currentId)) return;
        for (int i = index + 1; i < Math.min(index + 9, tracks.size()); i++) {
            if (tracks.get(i).id.equals(selectedId)) {
                index = i;
                load(0, true);
                return;
            }
        }
    }
    long positionMs() { return current() == null || player == null ? 0 : startAtMs + Math.max(0, player.getCurrentPosition()); }
    long durationMs() {
        Track track = current();
        if (track == null) return 0;
        if (track.durationMs > 0) return track.durationMs;
        long duration = player == null ? C.TIME_UNSET : player.getDuration();
        return duration > 0 ? startAtMs + duration : 0;
    }
    boolean canSeek() {
        return current() != null && player != null && error.isEmpty()
                && (current().transcode || player.isCurrentMediaItemSeekable());
    }

    private void createPlayer() {
        if (player != null) return;
        DefaultLoadControl buffers = new DefaultLoadControl.Builder()
                .setBufferDurationsMs(10000, 30000, 500, 1200).build();
        player = new ExoPlayer.Builder(this).setLoadControl(buffers).build();
        player.setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(), true);
        player.setHandleAudioBecomingNoisy(true);
        player.addListener(new Player.Listener() {
            @Override public void onPlaybackStateChanged(int state) {
                if (current() == null) return;
                if (state == Player.STATE_READY && preparing) {
                    preparing = false;
                    Log.i(LOG, "Ready after " + (SystemClock.elapsedRealtime() - started)
                            + " ms; playback source bytes received " + received.get());
                } else if (state == Player.STATE_ENDED && canSkip(1)) {
                    skip(1);
                }
            }
            @Override public void onPlayerError(PlaybackException failure) {
                preparing = false;
                error = "Couldn't play this track. Retry or choose another.";
                Log.w(LOG, "Playback failed (" + failure.getErrorCodeName() + ") after "
                        + (SystemClock.elapsedRealtime() - started) + " ms");
            }
            @Override public void onEvents(Player p, Player.Events events) { refresh(); }
        });
    }

    void play(String serverUrl, Map<String, String> credentials, String collectionId, List<Track> queue, int start, long positionMs) {
        // Reject any invalid item before replacing the existing queue.
        for (Track t : queue) PlaybackStream.address(serverUrl, t.path, t.transcode, 0);
        server = serverUrl;
        collection = collectionId;
        headers = new HashMap<>(credentials);
        tracks = queue;
        index = start;
        createPlayer();
        startService(new Intent(this, PlaybackService.class));
        session.setActive(true);
        long duration = current().durationMs;
        load(duration > 0 ? Math.min(positionMs, duration - 1) : positionMs, true);
    }

    private void load(long offsetMs, boolean autoplay) {
        Track track = current();
        if (track == null) return;
        startAtMs = track.transcode ? offsetMs : 0;
        started = SystemClock.elapsedRealtime();
        final long requestStart = started;
        preparing = true;
        error = "";
        Log.i(LOG, "Playback requested");
        AtomicBoolean first = new AtomicBoolean(true);
        OkHttpClient client = PlaybackStream.CLIENT.newBuilder().eventListener(new EventListener() {
            @Override public void responseHeadersEnd(Call call, Response response) {
                if (first.compareAndSet(true, false)) {
                    Log.i(LOG, "First HTTP response " + response.code() + " after "
                            + (SystemClock.elapsedRealtime() - requestStart) + " ms");
                }
            }
        }).build();
        OkHttpDataSource.Factory data = new OkHttpDataSource.Factory(client);
        data.setDefaultRequestProperties(headers);
        final AtomicLong bytes = new AtomicLong();
        received = bytes;
        data.setTransferListener(new TransferListener() {
            @Override public void onTransferInitializing(DataSource source, DataSpec spec, boolean network) {}
            @Override public void onTransferStart(DataSource source, DataSpec spec, boolean network) {}
            @Override public void onTransferEnd(DataSource source, DataSpec spec, boolean network) {}
            @Override public void onBytesTransferred(DataSource source, DataSpec spec, boolean network, int count) {
                if (count > 0 && bytes.getAndAdd(count) == 0) {
                    Log.i(LOG, "First audio bytes after " + (SystemClock.elapsedRealtime() - requestStart) + " ms");
                }
            }
        });
        MediaItem.Builder item = new MediaItem.Builder()
                .setUri(PlaybackStream.address(server, track.path, track.transcode, offsetMs));
        if (track.transcode) item.setMimeType(MimeTypes.AUDIO_MPEG);
        player.setMediaSource(new ProgressiveMediaSource.Factory(data).createMediaSource(item.build()),
                track.transcode ? 0 : offsetMs);
        player.setPlayWhenReady(autoplay);
        player.prepare();
        refresh();
    }

    void toggle() { if (isPlaying()) pause(); else resume(); }
    void pause() { if (player != null) player.pause(); }
    void resume() {
        if (current() == null || player == null) return;
        if (!error.isEmpty()) { load(startAtMs, true); return; }
        if (player.getPlaybackState() == Player.STATE_ENDED) { load(0, true); return; }
        player.play();
    }
    void seek(long ms) {
        if (!canSeek()) return;
        long duration = durationMs();
        long target = Math.max(0, duration > 0 ? Math.min(duration - 1, ms) : ms);
        // Aurral's transcoder pipes an unbounded HTTP 200. Time-based restarts ask
        // ffmpeg for the requested point without discarding encoded bytes on the TV.
        if (current().transcode) load(target, player.getPlayWhenReady());
        else player.seekTo(target);
    }
    void skip(int step) {
        if (!canSkip(step)) return;
        index += step;
        load(0, true);
    }

    private void refresh() {
        Track t = current();
        if (t != null && player != null) {
            long actions = PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_STOP;
            if (canSeek()) actions |= PlaybackState.ACTION_SEEK_TO;
            if (canSkip(1)) actions |= PlaybackState.ACTION_SKIP_TO_NEXT;
            if (canSkip(-1)) actions |= PlaybackState.ACTION_SKIP_TO_PREVIOUS;
            int state = !error.isEmpty() ? PlaybackState.STATE_ERROR :
                    buffering() ? PlaybackState.STATE_BUFFERING :
                    player.isPlaying() ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED;
            session.setPlaybackState(new PlaybackState.Builder().setActions(actions)
                    .setState(state, positionMs(), player.isPlaying() ? 1f : 0f).build());
            MediaMetadata.Builder metadata = new MediaMetadata.Builder().putString(MediaMetadata.METADATA_KEY_TITLE, t.title)
                    .putString(MediaMetadata.METADATA_KEY_ARTIST, t.artist);
            if (t.album != null) metadata.putString(MediaMetadata.METADATA_KEY_ALBUM, t.album);
            if (durationMs() > 0) metadata.putLong(MediaMetadata.METADATA_KEY_DURATION, durationMs());
            session.setMetadata(metadata.build());
            Intent open = getPackageManager().getLeanbackLaunchIntentForPackage(getPackageName());
            Notification.Builder notification = new Notification.Builder(this, CHANNEL).setSmallIcon(R.drawable.aurral_note)
                    .setContentTitle(t.title).setContentText(t.artist).setOnlyAlertOnce(true)
                    .setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken()));
            if (open != null) notification.setContentIntent(PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE));
            startForeground(NOTICE, notification.build());
        }
        main.removeCallbacks(progress);
        if (listener != null) {
            listener.run();
            if (player != null && player.isPlaying()) main.postDelayed(progress, 1000);
        }
    }

    void clear() {
        main.removeCallbacks(progress);
        tracks = Collections.emptyList();
        if (player != null) { player.release(); player = null; }
        server = null;
        collection = null;
        headers = Collections.emptyMap();
        index = 0;
        startAtMs = 0;
        preparing = false;
        error = "";
        session.setActive(false);
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
        if (listener != null) listener.run();
    }

    @Override public void onDestroy() {
        listener = null;
        main.removeCallbacks(progress);
        if (player != null) player.release();
        session.release();
        super.onDestroy();
    }
}
