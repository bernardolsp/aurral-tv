package com.aurral.tv.setup

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.io.IOException
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.UUID
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

private const val PORT = 44685

internal class RemoteServer(
  private val address: InetAddress,
  port: Int = PORT,
  private val command: (String, String) -> Unit,
) : Closeable {
  private val challenges = mutableMapOf<String,Long>()
  private val pending = ConcurrentHashMap<String, CompletableFuture<String>>()
  private val clients = ConcurrentHashMap.newKeySet<Socket>()
  private val acceptor = Executors.newSingleThreadExecutor()
  private val pool = ThreadPoolExecutor(2, 2, 0L, TimeUnit.SECONDS, ArrayBlockingQueue(4))
  private val listener = ServerSocket()
  val boundPort: Int get() = listener.localPort
  private fun now() = TimeUnit.NANOSECONDS.toMillis(System.nanoTime())
  init {
    try {
      listener.reuseAddress = true
      listener.bind(InetSocketAddress(address, port), 6)
      acceptor.execute {
        while (!listener.isClosed) {
          val client = try { listener.accept() } catch (_: IOException) { break }
          clients.add(client)
          try {
            pool.execute {
              try { client.use { handle(it) } } catch (_: Exception) {
                // A remote can disconnect or send a malformed request.
              } finally { clients.remove(client) }
            }
          } catch (_: java.util.concurrent.RejectedExecutionException) {
            clients.remove(client)
            client.close()
          }
        }
      }
    } catch (e: Exception) { close(); throw e }
  }

  @Synchronized private fun issue(): String {
    val now = now()
    challenges.entries.removeAll { it.value < now }
    if (challenges.size >= 32) throw IOException("Busy")
    val id = UUID.randomUUID().toString().replace("-", "")
    challenges[id] = now + 20000
    return id
  }

  @Synchronized private fun consume(id: String): Boolean =
    (challenges.remove(id) ?: 0L) > now()

  private fun handle(client: Socket) {
    if (!LanInbox.privateV4(client.inetAddress) && !(address.isLoopbackAddress && client.inetAddress.isLoopbackAddress)) return
    client.soTimeout = 4000
    val input = BufferedInputStream(client.getInputStream())
    val raw = ByteArrayOutputStream()
    var last = 0
    val deadline = now() + 5000
    while (last != 0x0d0a0d0a) {
      val c = input.read()
      if (c !in 0..127 || raw.size() >= 8192 || now() > deadline) return
      raw.write(c)
      last = (last shl 8) or c
    }
    val lines = raw.toString("US-ASCII").trimEnd('\r','\n').split("\r\n")
    val headers = mutableMapOf<String,String>()
    for (line in lines.drop(1)) {
      val split = line.indexOf(':')
      if (split < 1 || headers.put(line.substring(0,split).lowercase(),line.substring(split + 1).trim()) != null) return
    }
    if (headers["host"] != "${address.hostAddress}:$boundPort" ||
        headers.containsKey("origin") || headers.containsKey("transfer-encoding")) return
    fun reply(code: String, type: String, text: String) {
      val body = text.toByteArray(Charsets.US_ASCII)
      val out = client.getOutputStream()
      out.write("HTTP/1.1 $code\r\nContent-Type: $type\r\nContent-Length: ${body.size}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n".toByteArray(Charsets.US_ASCII))
      out.write(body)
      out.flush()
    }
    if (lines[0] == "GET /v1/remote/challenge HTTP/1.1") {
      reply("200 OK","application/json","{\"challenge\":\"${issue()}\"}")
      return
    }
    val match = Regex("POST /v1/remote/([a-f0-9]{32}) HTTP/1\\.1").matchEntire(lines[0]) ?: return
    val id = match.groupValues[1]
    val count = headers["content-length"]?.toIntOrNull() ?: return
    if (count !in 55..131072 || headers["content-type"] != "application/octet-stream" || !consume(id)) {
      reply("400 Bad Request","text/plain",""); return
    }
    val bytes = ByteArray(count)
    var offset = 0
    while (offset < bytes.size) {
      val n = input.read(bytes, offset, bytes.size - offset)
      if (n < 1 || now() > deadline) return
      offset += n
    }
    val body = bytes.toString(Charsets.US_ASCII)
    if (!body.matches(Regex("[A-Za-z0-9_-]+"))) return
    val result = CompletableFuture<String>()
    pending[id] = result
    try {
      command(id, body)
      val answer = result.get(12, TimeUnit.SECONDS)
      if (answer.isEmpty()) reply("403 Forbidden","text/plain","")
      else reply("200 OK","application/octet-stream",answer)
    } finally { pending.remove(id) }
  }

  fun finish(id: String, body: String) { pending[id]?.complete(body) }
  override fun close() {
    listener.close()
    pending.values.forEach { it.cancel(false) }
    clients.forEach { runCatching { it.close() } }
    acceptor.shutdownNow()
    pool.shutdownNow()
  }
}

class PocketRemoteModule : Module() {
  private val owner = Executors.newSingleThreadExecutor()
  @Volatile private var foreground = true
  @Volatile private var server: RemoteServer? = null
  private fun stopServer() { server?.close(); server = null }
  override fun definition() = ModuleDefinition {
    Name("AurralPocketRemote")
    Events("command")
    AsyncFunction("start") { promise: Promise ->
      owner.execute {
        try {
          if (!foreground) throw IOException()
          val cm = appContext.reactContext!!.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
          val net = cm.activeNetwork ?: throw IOException()
          val caps = cm.getNetworkCapabilities(net) ?: throw IOException()
          if (!caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) && !caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) throw IOException()
          val addr = cm.getLinkProperties(net)?.linkAddresses?.map { it.address }?.firstOrNull { LanInbox.privateV4(it) } ?: throw IOException()
          if (server == null) server = RemoteServer(addr) { id, body -> sendEvent("command",mapOf("challenge" to id,"body" to body)) }
          promise.resolve(null)
        } catch (_: Exception) { promise.reject("E_REMOTE","TV remote unavailable on this network",null) }
      }
    }
    AsyncFunction("finish") { id: String, body: String -> server?.finish(id, body); Unit }
    AsyncFunction("stop") { promise: Promise -> owner.execute { stopServer(); promise.resolve(null) } }
    OnActivityEntersForeground { foreground = true }
    OnActivityEntersBackground { foreground = false; if (!owner.isShutdown) owner.execute { stopServer() } }
    OnDestroy { foreground = false; owner.execute { stopServer() }; owner.shutdown() }
  }
}
