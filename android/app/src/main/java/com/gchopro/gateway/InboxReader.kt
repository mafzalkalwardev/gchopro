package com.gchopro.gateway

import android.content.Context
import android.provider.Telephony
import org.json.JSONArray
import org.json.JSONObject

object InboxReader {
    fun readNew(context: Context): JSONArray {
        val rows = JSONArray()
        val last = Store.lastProviderId(context)
        val cursor = context.contentResolver.query(
            Telephony.Sms.Inbox.CONTENT_URI,
            arrayOf(
                Telephony.Sms._ID,
                Telephony.Sms.ADDRESS,
                Telephony.Sms.BODY,
                Telephony.Sms.DATE,
                Telephony.Sms.SUBSCRIPTION_ID,
            ),
            "${Telephony.Sms._ID} > ? AND ${Telephony.Sms.TYPE} = ?",
            arrayOf(last.toString(), Telephony.Sms.MESSAGE_TYPE_INBOX.toString()),
            "${Telephony.Sms._ID} ASC",
        ) ?: return rows
        var max = last
        cursor.use {
            val idCol = it.getColumnIndexOrThrow(Telephony.Sms._ID)
            val addressCol = it.getColumnIndexOrThrow(Telephony.Sms.ADDRESS)
            val bodyCol = it.getColumnIndexOrThrow(Telephony.Sms.BODY)
            val dateCol = it.getColumnIndexOrThrow(Telephony.Sms.DATE)
            val subCol = it.getColumnIndexOrThrow(Telephony.Sms.SUBSCRIPTION_ID)
            while (it.moveToNext()) {
                val id = it.getLong(idCol)
                if (id > max) max = id
                rows.put(
                    JSONObject()
                        .put("providerId", id.toString())
                        .put("subscriptionId", it.getInt(subCol))
                        .put("address", it.getString(addressCol) ?: "")
                        .put("body", it.getString(bodyCol) ?: "")
                        .put("direction", "in")
                        .put("receivedAt", java.time.Instant.ofEpochMilli(it.getLong(dateCol)).toString()),
                )
            }
        }
        if (max > last) Store.setLastProviderId(context, max)
        return rows
    }
}
