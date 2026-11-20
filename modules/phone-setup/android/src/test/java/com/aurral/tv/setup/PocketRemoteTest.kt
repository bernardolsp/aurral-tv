package com.aurral.tv.setup

import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.URL
import org.junit.Assert.*
import org.junit.Test

class PocketRemoteTest {
    @Test fun oneChallengeCanDeliverOnlyOneCommand() {
        val payload = "Q".repeat(100)
        lateinit var remote: RemoteServer
        remote = RemoteServer(InetAddress.getByName("127.0.0.1"), 0) { challenge, body ->
            remote.finish(challenge, if (body == payload) "reply" else "")
        }
        remote.use {
            val base = "http://127.0.0.1:${remote.boundPort}/v1/remote/"
            val challenge = Regex("[a-f0-9]{32}").find(URL(base + "challenge").readText())!!.value
            fun send(data: String): Int {
                val req = URL(base + challenge).openConnection() as HttpURLConnection
                try {
                    req.requestMethod = "POST"
                    req.setRequestProperty("Content-Type", "application/octet-stream")
                    req.doOutput = true
                    req.setFixedLengthStreamingMode(data.length)
                    req.outputStream.use { it.write(data.toByteArray()) }
                    return req.responseCode
                } finally { req.disconnect() }
            }
            assertEquals(200, send(payload))
            assertEquals(400, send(payload))
        }
    }
}
