package com.gchopro.gateway

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.os.Build
import android.os.IBinder
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

class GatewayService : Service() {
    private val running = AtomicBoolean(false)
    private val executor = Executors.newSingleThreadExecutor()
    private var lastHeartbeat = 0L
    private var lastSimReport = 0L
    private var pollMs = 10_000L

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(NOTICE_ID, notification())
        if (running.compareAndSet(false, true)) executor.execute { loop() }
        return START_STICKY
    }

    override fun onDestroy() {
        running.set(false)
        executor.shutdownNow()
        super.onDestroy()
    }

    private fun loop() {
        while (running.get()) {
            try {
                cycle()
            } catch (_: DeviceRevoked) {
                Store.clear(this)
                stopSelf()
                return
            } catch (_: Exception) {
            }
            try {
                Thread.sleep(pollMs)
            } catch (_: InterruptedException) {
                return
            }
        }
    }

    private fun cycle() {
        val client = DeskClient.from(this) ?: return
        val now = System.currentTimeMillis()
        if (now - lastHeartbeat >= 30_000L) {
            val beat = client.heartbeat(heartbeatBody())
            lastHeartbeat = now
            if (beat.rotate) rotate(client)
            pollMs = if (beat.body.optBoolean("requestSimReport")) 3_000L else pollMs
            if (beat.body.optBoolean("requestSimReport") || now - lastSimReport >= 5 * 60_000L) {
                val report = client.sims(SimReader.report(this))
                lastSimReport = now
                if (report.rotate) rotate(client)
            }
        }
        flushReports(client)
        val pending = client.pending()
        if (pending.rotate) rotate(client)
        val messages = pending.body.optJSONArray("messages")
        pollMs = if (messages != null && messages.length() > 0) 3_000L else 10_000L
        if (messages == null) return
        val active = SimReader.report(this).getJSONArray("sims")
        val activeIds = mutableSetOf<Int>()
        for (i in 0 until active.length()) activeIds.add(active.getJSONObject(i).getInt("subscriptionId"))
        for (i in 0 until messages.length()) {
            val row = messages.getJSONObject(i)
            val id = row.getString("id")
            if (Store.sentIds(this).contains(id)) continue
            val sent = SmsSender.send(
                this,
                Dispatch(
                    id,
                    row.getInt("subscriptionId"),
                    row.getInt("slotIndex"),
                    row.getString("address"),
                    row.getString("body"),
                ),
                activeIds.contains(row.getInt("subscriptionId")),
            )
            if (sent) break
        }
    }

    private fun flushReports(client: DeskClient) {
        val store = ReportStore(this)
        val policy = ReportOutbox()
        for (report in store.due(System.currentTimeMillis())) {
            try {
                val response = client.report(
                    JSONObject()
                        .put("id", report.messageId)
                        .put("event", report.event)
                        .put("partIndex", report.partIndex)
                        .put("partCount", report.partCount)
                        .put("subscriptionId", report.subscriptionId)
                        .put("resultCode", report.resultCode)
                        .put("resultName", report.resultName)
                        .put("at", java.time.Instant.now().toString()),
                )
                if (response.rotate) rotate(client)
                store.acknowledge(report)
            } catch (_: DeviceRevoked) {
                throw DeviceRevoked()
            } catch (_: Exception) {
                store.retryLater(report, policy.nextDelayMs(report.attempts))
            }
        }
    }

    private fun rotate(client: DeskClient) {
        val rotated = client.rotate()
        val token = rotated.body.optString("token")
        if (token.length == 64) Store.replaceToken(this, token)
    }

    private fun heartbeatBody(): JSONObject {
        val filter = registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level = filter?.getIntExtra(BatteryManager.EXTRA_LEVEL, 0) ?: 0
        val scale = (filter?.getIntExtra(BatteryManager.EXTRA_SCALE, 100) ?: 100).coerceAtLeast(1)
        val plugged = filter?.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) ?: 0
        val version = packageManager.getPackageInfo(packageName, 0).versionName ?: "2.0.0"
        return JSONObject()
            .put("battery", (level * 100) / scale)
            .put("charging", plugged != 0)
            .put("network", "unknown")
            .put("appVersion", version)
            .put("androidSdk", Build.VERSION.SDK_INT)
            .put("activeModemCount", SimReader.report(this).getInt("slotsOnDevice"))
            .put("uptimeSec", android.os.SystemClock.elapsedRealtime() / 1000)
    }

    private fun notification(): Notification {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL, getString(R.string.channel), NotificationManager.IMPORTANCE_LOW),
        )
        return Notification.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_notify_chat)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(getString(R.string.notification))
            .setOngoing(true)
            .build()
    }

    companion object {
        private const val NOTICE_ID = 7
        private const val CHANNEL = "gateway"

        fun start(context: Context) {
            context.startForegroundService(Intent(context, GatewayService::class.java))
        }
    }
}
