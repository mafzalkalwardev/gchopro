package com.gchopro.gateway

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class SmsStatusReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val messageId = intent.getStringExtra("messageId") ?: return
        val partIndex = intent.getIntExtra("partIndex", 0)
        val partCount = intent.getIntExtra("partCount", 1)
        val subscriptionId = intent.getIntExtra("subscriptionId", -1)
        val delivered = intent.action == "com.gchopro.gateway.SMS_DELIVERED"
        val pdu = intent.getByteArrayExtra("pdu")
        val pduStatus = pdu?.lastOrNull()?.toInt()?.and(0xFF)
        val event = when {
            delivered && pduStatus != null -> deliveryEvent(pduStatus)
            delivered && resultCode == Activity.RESULT_OK -> "delivered"
            delivered -> "delivery_failed"
            resultCode == Activity.RESULT_OK -> "sent"
            else -> "failed"
        }
        val name = if (event == "sent" || event == "delivered") "OK" else resultName(resultCode)
        ReportStore(context).enqueue(
            PendingReport(messageId, event, partIndex, partCount, subscriptionId, resultCode, name),
            0,
        )
    }
}
