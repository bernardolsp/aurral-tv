package com.aurral.tv.setup

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.IOException
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException

class PhoneSetupModule : Module() {
  // Opening, acknowledging and closing a socket may all do I/O. The independent reader
  // lets a close interrupt a pending accept without blocking the activity or Expo queues.
  private val controls = Executors.newSingleThreadExecutor()
  private val reader = Executors.newSingleThreadExecutor()
  private var session: LanInbox? = null
  @Volatile private var backgrounded = false

  private fun submit(promise: Promise, operation: () -> Unit) {
    try {
      controls.execute {
        try { operation() }
        catch (_: Exception) { promise.reject("CLOSED", "Pairing is unavailable", null) }
      }
    } catch (_: RejectedExecutionException) {
      promise.reject("CLOSED", "Pairing closed", null)
    }
  }

  override fun definition() = ModuleDefinition {
    Name("AurralPhoneSetup")

    AsyncFunction("open") { id: String, promise: Promise ->
      submit(promise) {
        val context = appContext.reactContext ?: throw IOException("TV unavailable")
        val connectivity = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val network = connectivity.activeNetwork ?: throw IOException("No LAN")
        val caps = connectivity.getNetworkCapabilities(network) ?: throw IOException("No LAN")
        if (!caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) &&
            !caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) throw IOException("No LAN")
        val ip = connectivity.getLinkProperties(network)?.linkAddresses?.map { it.address }
          ?.firstOrNull { LanInbox.privateV4(it) } ?: throw IOException("No private LAN address")
        closeSession()
        if (backgrounded) throw IOException("Pairing requires an active TV")
        val inbox = LanInbox(ip, id, 120_000L)
        session = inbox
        promise.resolve(mapOf("address" to ip.hostAddress, "port" to inbox.port()))
      }
    }

    AsyncFunction("receive") { id: String, promise: Promise ->
      submit(promise) {
        val inbox = session?.takeIf { it.id == id && !backgrounded } ?: throw IOException("Pairing closed")
        reader.execute {
          try { promise.resolve(inbox.next()) }
          catch (_: IOException) { promise.reject("CLOSED", "Pairing closed", null) }
        }
      }
    }

    AsyncFunction("finish") { id: String, accepted: Boolean, promise: Promise ->
      submit(promise) {
        promise.resolve(session?.takeIf { !backgrounded && it.id == id }?.finish(accepted) ?: false)
      }
    }
    AsyncFunction("close") { id: String, promise: Promise ->
      submit(promise) {
        if (session?.id == id) closeSession()
        promise.resolve(null)
      }
    }
    OnActivityEntersForeground { backgrounded = false }
    OnActivityEntersBackground {
      backgrounded = true
      if (!controls.isShutdown) controls.execute { closeSession() }
    }
    OnDestroy {
      backgrounded = true
      controls.execute {
        closeSession()
        reader.shutdown()
      }
      controls.shutdown()
    }
  }

  private fun closeSession() {
    session?.close()
    session = null
  }
}
