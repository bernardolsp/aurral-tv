package com.aurral.tv.setup

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.IOException
import java.util.concurrent.Executors

class PhoneSetupModule : Module() {
  private val reader = Executors.newSingleThreadExecutor()
  private val gate = Any()
  private var session: LanInbox? = null
  private var backgrounded = false

  override fun definition() = ModuleDefinition {
    Name("AurralPhoneSetup")

    AsyncFunction("open") { id: String ->
      val context = appContext.reactContext ?: throw IOException("TV unavailable")
      val connectivity = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
      val network = connectivity.activeNetwork ?: throw IOException("No LAN")
      val caps = connectivity.getNetworkCapabilities(network) ?: throw IOException("No LAN")
      if (!caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) &&
          !caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) throw IOException("No LAN")
      val ip = connectivity.getLinkProperties(network)?.linkAddresses?.map { it.address }
        ?.firstOrNull { LanInbox.privateV4(it) } ?: throw IOException("No private LAN address")
      synchronized(gate) {
        if (backgrounded) throw IOException("Pairing requires an active TV")
        session?.close()
        val inbox = LanInbox(ip, id, 120_000L)
        session = inbox
        mapOf("address" to ip.hostAddress, "port" to inbox.port())
      }
    }

    AsyncFunction("receive") { id: String, promise: Promise ->
      val inbox = synchronized(gate) { session?.takeIf { it.id == id } }
      if (inbox == null) {
        promise.reject("CLOSED", "Pairing closed", null)
      } else {
        reader.execute {
          try {
            promise.resolve(inbox.next())
          } catch (_: IOException) {
            promise.reject("CLOSED", "Pairing closed", null)
          }
        }
      }
    }

    AsyncFunction("finish") { id: String, accepted: Boolean ->
      synchronized(gate) { session?.takeIf { it.id == id }?.finish(accepted) ?: false }
    }
    AsyncFunction("close") { id: String ->
      synchronized(gate) { if (session?.id == id) closeSession() }
    }
    OnActivityEntersForeground { synchronized(gate) { backgrounded = false } }
    OnActivityEntersBackground {
      synchronized(gate) {
        backgrounded = true
        closeSession()
      }
    }
    OnDestroy {
      closeSession()
      reader.shutdownNow()
    }
  }

  private fun closeSession() = synchronized(gate) {
    session?.close()
    session = null
  }
}
