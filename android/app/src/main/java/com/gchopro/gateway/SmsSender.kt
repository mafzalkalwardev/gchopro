package com.gchopro.gateway

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.PowerManager
import android.telephony.SmsManager
import java.util.concurrent.atomic.AtomicBoolean

data class Dispatch(
    val messageId: String,
    val subscriptionId: Int,
    val slotIndex: Int,
    val address: String,
    val body: String,
)

object SmsSender {
    private val busy = AtomicBoolean(false)

    fun managerFor(subscriptionId: Int): SmsManager =
        SmsManager.getSmsManagerForSubscriptionId(subscriptionId)

    fun send(context: Context, dispatch: Dispatch, active: Boolean): Boolean {
        val refusal = localRefusal(active)
        if (refusal != null) {
            ReportStore(context).enqueue(
                PendingReport(dispatch.messageId, "failed", 0, 1, dispatch.subscriptionId, -1, refusal),
                0,
            )
            return false
        }
        if (!busy.compareAndSet(false, true)) return false
        val power = context.getSystemService(PowerManager::class.java)
        val lock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "gchopro:send")
        lock.acquire(30_000)
        try {
            val sms = managerFor(dispatch.subscriptionId)
            val parts = sms.divideMessage(dispatch.body)
            if (parts.size <= 1) {
                sms.sendTextMessage(
                    dispatch.address,
                    null,
                    dispatch.body,
                    statusIntent(context, dispatch, 0, 1, "com.gchopro.gateway.SMS_SENT"),
                    statusIntent(context, dispatch, 0, 1, "com.gchopro.gateway.SMS_DELIVERED"),
                )
            } else {
                val sent = ArrayList<PendingIntent>()
                val delivered = ArrayList<PendingIntent>()
                parts.forEachIndexed { index, _ ->
                    sent.add(statusIntent(context, dispatch, index, parts.size, "com.gchopro.gateway.SMS_SENT"))
                    delivered.add(statusIntent(context, dispatch, index, parts.size, "com.gchopro.gateway.SMS_DELIVERED"))
                }
                sms.sendMultipartTextMessage(dispatch.address, null, parts, sent, delivered)
            }
            Store.rememberSent(context, dispatch.messageId)
            return true
        } finally {
            busy.set(false)
            if (lock.isHeld) lock.release()
        }
    }

    private fun statusIntent(
        context: Context,
        dispatch: Dispatch,
        partIndex: Int,
        partCount: Int,
        action: String,
    ): PendingIntent {
        val intent = Intent(context, SmsStatusReceiver::class.java).apply {
            this.action = action
            putExtra("messageId", dispatch.messageId)
            putExtra("partIndex", partIndex)
            putExtra("partCount", partCount)
            putExtra("subscriptionId", dispatch.subscriptionId)
        }
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        return PendingIntent.getBroadcast(context, "$action:${dispatch.messageId}:$partIndex".hashCode(), intent, flags)
    }
}
