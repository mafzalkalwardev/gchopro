package com.gchopro.gateway

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

class ReportStore(context: Context) : SQLiteOpenHelper(context, "reports.db", null, 1) {
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """
            create table reports (
              message_id text not null,
              event text not null,
              part_index integer not null,
              part_count integer not null,
              subscription_id integer not null,
              result_code integer not null,
              result_name text not null,
              attempts integer not null,
              next_at integer not null,
              primary key (message_id, event, part_index)
            )
            """.trimIndent(),
        )
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit

    fun enqueue(report: PendingReport, delayMs: Long) {
        val values = ContentValues().apply {
            put("message_id", report.messageId)
            put("event", report.event)
            put("part_index", report.partIndex)
            put("part_count", report.partCount)
            put("subscription_id", report.subscriptionId)
            put("result_code", report.resultCode)
            put("result_name", report.resultName)
            put("attempts", report.attempts)
            put("next_at", System.currentTimeMillis() + delayMs)
        }
        writableDatabase.insertWithOnConflict("reports", null, values, SQLiteDatabase.CONFLICT_IGNORE)
    }

    fun due(now: Long): List<PendingReport> {
        val rows = mutableListOf<PendingReport>()
        readableDatabase.query(
            "reports",
            arrayOf("message_id", "event", "part_index", "part_count", "subscription_id", "result_code", "result_name", "attempts"),
            "next_at <= ?",
            arrayOf(now.toString()),
            null,
            null,
            "next_at asc",
        ).use { cursor ->
            while (cursor.moveToNext()) {
                rows.add(
                    PendingReport(
                        cursor.getString(0),
                        cursor.getString(1),
                        cursor.getInt(2),
                        cursor.getInt(3),
                        cursor.getInt(4),
                        cursor.getInt(5),
                        cursor.getString(6),
                        cursor.getInt(7),
                    ),
                )
            }
        }
        return rows
    }

    fun acknowledge(report: PendingReport) {
        writableDatabase.delete(
            "reports",
            "message_id = ? and event = ? and part_index = ?",
            arrayOf(report.messageId, report.event, report.partIndex.toString()),
        )
    }

    fun retryLater(report: PendingReport, delayMs: Long) {
        val values = ContentValues().apply {
            put("attempts", report.attempts + 1)
            put("next_at", System.currentTimeMillis() + delayMs)
        }
        writableDatabase.update(
            "reports",
            values,
            "message_id = ? and event = ? and part_index = ?",
            arrayOf(report.messageId, report.event, report.partIndex.toString()),
        )
    }
}
