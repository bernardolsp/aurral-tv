package com.aurral.tv.audio;

import android.app.*;
import android.content.Intent;
import android.media.*;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import java.net.URL;
import android.os.Binder;
import android.os.IBinder;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public final class PlaybackService extends Service {
    private static final String CHANNEL = "playback";
    private static final int NOTICE = 1;
    final class LocalBinder extends Binder {
        PlaybackService service() { return PlaybackService.this; }
    }

    private final LocalBinder binder = new LocalBinder();
    private final AudioAttributes attributes = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build();
    private AudioFocusRequest focus;
    private AudioManager audio;
    private MediaSession session;
    private MediaPlayer player;
    private String server, collection;
    private Map<String, String> headers = Collections.emptyMap();
    static final class Track {
        final String id, title, artist;
        Track(String id, String title, String artist) { this.id = id; this.title = title; this.artist = artist; }
    }
    private ServerAudioSource source;
    private List<Track> tracks = Collections.emptyList();
    private int index;
    private boolean prepared, playing, resumeOnFocus;
    private String error = "";
    Runnable listener;

    @Override public IBinder onBind(Intent intent) { return binder; }
    @Override public int onStartCommand(Intent intent, int flags, int startId) { return START_NOT_STICKY; }

    @Override public void onCreate() {
        super.onCreate();
        getSystemService(NotificationManager.class).createNotificationChannel(
                new NotificationChannel(CHANNEL, "Playback", NotificationManager.IMPORTANCE_LOW));
        audio = getSystemService(AudioManager.class);
        focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(attributes)
                .setOnAudioFocusChangeListener(change -> {
                    if (change < 0) {
                        boolean interrupted = playing && change != AudioManager.AUDIOFOCUS_LOSS;
                        pause();
                        resumeOnFocus = interrupted;
                    } else if (change == AudioManager.AUDIOFOCUS_GAIN && resumeOnFocus) {
                        resumeOnFocus = false;
                        resume();
                    }
                }).build();
        session = new MediaSession(this, "Aurral TV");
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { resume(); }
            @Override public void onPause() { pause(); }
            @Override public void onSkipToNext() { skip(1); }
            @Override public void onSkipToPrevious() { skip(-1); }
            @Override public void onStop() { clear(); }
        });
    }

    Track current() { return tracks.isEmpty() ? null : tracks.get(index); }
    boolean isPlaying() { return playing; }
    boolean canSkip(int step) { return index + step >= 0 && index + step < tracks.size(); }
    String message() { return error; }

    String collectionId() { return collection; }
    void play(String serverUrl, Map<String, String> credentials, String collectionId, List<Track> queue, int start) {
        server = serverUrl;
        collection = collectionId;
        headers = new HashMap<>(credentials);
        tracks = queue;
        index = start;
        load();
    }

    private void releasePlayer() {
        prepared = false;
        if (player != null) {
            player.release();
            player = null;
        }
        if (source != null) {
            try { source.close(); } catch (java.io.IOException ignored) {}
            source = null;
        }
    }

    private void load() {
        releasePlayer();
        error = "";
        playing = false;
        resumeOnFocus = false;
        session.setActive(true);
        startService(new Intent(this, PlaybackService.class));
        refresh();
        if (audio.requestAudioFocus(focus) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
            fail("Audio is in use. Select Play to retry.");
            return;
        }
        MediaPlayer next = new MediaPlayer();
        player = next;
        next.setAudioAttributes(attributes);
        next.setOnPreparedListener(mp -> {
            if (player != mp) return;
            prepared = true;
            if (playing) mp.start();
            refresh();
        });
        next.setOnCompletionListener(mp -> {
            if (player != mp) return;
            if (canSkip(1)) skip(1);
            else {
                playing = false;
                audio.abandonAudioFocusRequest(focus);
                refresh();
            }
        });
        next.setOnErrorListener((mp, what, extra) -> {
            if (player == mp) fail("Couldn't play this track. Retry or choose another.");
            return true;
        });
        try {
            URL url = new URL(server + "/api/playlists/stream/" + android.net.Uri.encode(current().id));
            source = new ServerAudioSource(url, headers);
            next.setDataSource(source);
            playing = true;
            next.prepareAsync();
            refresh();
        } catch (Exception e) {
            fail("Couldn't open the audio stream.");
        }
    }

    private void fail(String detail) {
        releasePlayer();
        playing = false;
        error = detail;
        audio.abandonAudioFocusRequest(focus);
        refresh();
    }

    void toggle() { if (playing) pause(); else resume(); }
    void pause() {
        playing = false;
        resumeOnFocus = false;
        if (prepared && player.isPlaying()) player.pause();
        refresh();
    }
    void resume() {
        if (current() == null) return;
        if (player == null) { load(); return; }
        if (audio.requestAudioFocus(focus) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) return;
        playing = true;
        if (prepared) player.start();
        refresh();
    }
    void skip(int step) {
        if (!canSkip(step)) return;
        index += step;
        load();
    }

    private void refresh() {
        Track t = current();
        if (t != null) {
            long actions = PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_STOP;
            if (canSkip(1)) actions |= PlaybackState.ACTION_SKIP_TO_NEXT;
            if (canSkip(-1)) actions |= PlaybackState.ACTION_SKIP_TO_PREVIOUS;
            int state = !error.isEmpty() ? PlaybackState.STATE_ERROR :
                    playing ? (prepared ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_BUFFERING) : PlaybackState.STATE_PAUSED;
            session.setPlaybackState(new PlaybackState.Builder().setActions(actions)
                    .setState(state, prepared ? player.getCurrentPosition() : 0, playing ? 1f : 0f).build());
            session.setMetadata(new MediaMetadata.Builder().putString(MediaMetadata.METADATA_KEY_TITLE, t.title)
                    .putString(MediaMetadata.METADATA_KEY_ARTIST, t.artist).build());
            Intent open = getPackageManager().getLeanbackLaunchIntentForPackage(getPackageName());
            Notification notification = new Notification.Builder(this, CHANNEL).setSmallIcon(R.drawable.aurral_note)
                    .setContentTitle(t.title).setContentText(t.artist).setOnlyAlertOnce(true)
                    .setContentIntent(PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE))
                    .setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken())).build();
            startForeground(NOTICE, notification);
        }
        if (listener != null) listener.run();
    }

    void clear() {
        releasePlayer();
        tracks = Collections.emptyList();
        server = null;
        collection = null;
        headers = Collections.emptyMap();
        index = 0;
        playing = false;
        resumeOnFocus = false;
        error = "";
        audio.abandonAudioFocusRequest(focus);
        session.setActive(false);
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
        if (listener != null) listener.run();
    }

    @Override public void onDestroy() {
        listener = null;
        releasePlayer();
        audio.abandonAudioFocusRequest(focus);
        session.release();
        super.onDestroy();
    }
}
