package com.gchopro.gateway

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

class DeviceRevoked : IllegalStateException("device_revoked")

data class GatewayResponse(val code: Int, val body: JSONObject, val rotate: Boolean)

class DeskClient(
    private val baseUrl: String,
    private val deviceId: String,
    private val token: String,
) {
    fun heartbeat(payload: JSONObject): GatewayResponse =
        post("/api/devices/$deviceId/heartbeat", payload)

    fun sims(payload: JSONObject): GatewayResponse =
        post("/api/devices/$deviceId/sims", payload)

    fun pending(): GatewayResponse = get("/api/devices/$deviceId/pending")

    fun report(payload: JSONObject): GatewayResponse =
        post("/api/devices/$deviceId/report", payload)

    fun inbox(rows: JSONArray): GatewayResponse =
        post("/api/devices/$deviceId/inbox", JSONObject().put("messages", rows))

    fun rotate(): GatewayResponse = post("/api/devices/$deviceId/token/rotate", JSONObject())

    private fun get(path: String): GatewayResponse = exchange(path, "GET", null)

    private fun post(path: String, body: JSONObject): GatewayResponse = exchange(path, "POST", body)

    private fun exchange(path: String, method: String, body: JSONObject?): GatewayResponse {
        val connection = URL(baseUrl.trimEnd('/') + path).openConnection() as HttpURLConnection
        connection.requestMethod = method
        connection.connectTimeout = 8000
        connection.readTimeout = 8000
        connection.setRequestProperty("Authorization", "Bearer $token")
        connection.setRequestProperty("X-Gateway-Protocol", "2")
        connection.setRequestProperty("Accept", "application/json")
        if (body != null) {
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            OutputStreamWriter(connection.outputStream).use { it.write(body.toString()) }
        }
        val stream = if (connection.responseCode in 200..299) connection.inputStream else connection.errorStream
        val text = stream?.bufferedReader()?.use(BufferedReader::readText) ?: ""
        val rotate = connection.getHeaderField("X-Gateway-Rotate") == "1"
        if (connection.responseCode == 401) throw DeviceRevoked()
        val json = if (text.isBlank()) JSONObject() else JSONObject(text)
        if (connection.responseCode !in 200..299) {
            throw IllegalStateException("Gateway ${connection.responseCode}")
        }
        return GatewayResponse(connection.responseCode, json, rotate)
    }

    companion object {
        fun from(context: Context): DeskClient? {
            if (!Store.ready(context)) return null
            return DeskClient(Store.baseUrl(context), Store.deviceId(context), Store.token(context))
        }

        fun register(baseUrl: String, code: String, name: String, model: String, sdk: Int, version: String): JSONObject {
            val connection = URL(baseUrl.trimEnd('/') + "/api/devices/register").openConnection() as HttpURLConnection
            connection.requestMethod = "POST"
            connection.doOutput = true
            connection.connectTimeout = 8000
            connection.readTimeout = 8000
            connection.setRequestProperty("Content-Type", "application/json")
            connection.setRequestProperty("X-Gateway-Protocol", "2")
            val body = JSONObject()
                .put("code", code)
                .put("name", name)
                .put("protocolVersion", 2)
                .put("appVersion", version)
                .put("model", model)
                .put("androidSdk", sdk)
            OutputStreamWriter(connection.outputStream).use { it.write(body.toString()) }
            val stream = if (connection.responseCode in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader()?.use(BufferedReader::readText) ?: ""
            if (connection.responseCode !in 200..299) throw IllegalStateException(text.ifBlank { "Register failed" })
            return JSONObject(text)
        }
    }
}
