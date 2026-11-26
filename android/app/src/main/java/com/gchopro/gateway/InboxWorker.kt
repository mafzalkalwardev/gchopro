package com.gchopro.gateway

import android.content.Context
import androidx.work.Worker
import androidx.work.WorkerParameters

class InboxWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        val client = DeskClient.from(applicationContext) ?: return Result.success()
        val rows = InboxReader.readNew(applicationContext)
        if (rows.length() == 0) return Result.success()
        return try {
            client.inbox(rows)
            Result.success()
        } catch (_: DeviceRevoked) {
            Store.clear(applicationContext)
            Result.failure()
        } catch (_: Exception) {
            Result.retry()
        }
    }
}
