package com.aurral.tv.audio

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.IBinder
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import java.net.URI

class AurralAudioModule : Module() {
    private var service: PlaybackService? = null
    private var boundContext: Context? = null
    private val pending = mutableListOf<Promise>()
    private val binding = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName, binder: IBinder) {
            service = (binder as PlaybackService.LocalBinder).service()
            service?.listener = Runnable { sendEvent("changed", snapshot()) }
            pending.forEach { it.resolve(null) }
            pending.clear()
        }
        override fun onServiceDisconnected(name: ComponentName) { service = null }
    }

    private fun snapshot(): Map<String, Any?> {
        val playback = service
        val track = playback?.current()
        return mapOf("id" to track?.id, "title" to track?.title, "artist" to track?.artist,
            "collectionId" to playback?.collectionId(), "playing" to (playback?.isPlaying ?: false),
            "previous" to (playback?.canSkip(-1) ?: false), "next" to (playback?.canSkip(1) ?: false),
            "message" to playback?.message())
    }

    override fun definition() = ModuleDefinition {
        Name("AurralAudio")
        Events("changed")
        AsyncFunction("connect") { promise: Promise ->
            if (service != null) { promise.resolve(null); return@AsyncFunction }
            pending.add(promise)
            if (boundContext == null) {
                val context = requireNotNull(appContext.reactContext).applicationContext
                if (context.bindService(Intent(context, PlaybackService::class.java), binding, Context.BIND_AUTO_CREATE)) {
                    boundContext = context
                } else {
                    pending.clear()
                    promise.reject("ERR_PLAYBACK_INIT", "The Android audio service could not start.", null)
                }
            }
        }.runOnQueue(Queues.MAIN)
        AsyncFunction("state") { snapshot() }.runOnQueue(Queues.MAIN)
        AsyncFunction("play") { server: String, headers: Map<String, String>, collection: String, items: List<Map<String, String>>, start: Int ->
            val uri = URI(server)
            require(uri.scheme in listOf("http","https") && uri.host != null && uri.userInfo == null && uri.query == null && uri.fragment == null)
            require(start in items.indices)
            val tracks = items.map { PlaybackService.Track(it.getValue("id"), it.getValue("title"), it.getValue("artist")) }
            requireNotNull(service).play(server, headers, collection, tracks, start)
        }.runOnQueue(Queues.MAIN)
        AsyncFunction("toggle") { service?.toggle() }.runOnQueue(Queues.MAIN)
        AsyncFunction("skip") { step: Int -> require(step == 1 || step == -1); service?.skip(step) }.runOnQueue(Queues.MAIN)
        AsyncFunction("clear") { service?.clear() }.runOnQueue(Queues.MAIN)
        OnDestroy {
            android.os.Handler(android.os.Looper.getMainLooper()).post {
                service?.listener = null
                boundContext?.unbindService(binding)
                boundContext = null
                service = null
                pending.forEach { it.reject("ERR_PLAYBACK_INIT", "The TV player closed.", null) }
                pending.clear()
            }
        }
    }
}
