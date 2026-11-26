package com.gchopro.gateway

data class PendingReport(
    val messageId: String,
    val event: String,
    val partIndex: Int,
    val partCount: Int,
    val subscriptionId: Int,
    val resultCode: Int,
    val resultName: String,
    val attempts: Int = 0,
)

class ReportOutbox {
    private val pending = mutableListOf<PendingReport>()

    fun enqueue(report: PendingReport) {
        pending.add(report)
    }

    fun pending(): List<PendingReport> = pending.toList()

    fun acknowledge(messageId: String, event: String, partIndex: Int) {
        pending.removeAll { it.messageId == messageId && it.event == event && it.partIndex == partIndex }
    }

    fun markAttempt(messageId: String, event: String, partIndex: Int) {
        val index = pending.indexOfFirst {
            it.messageId == messageId && it.event == event && it.partIndex == partIndex
        }
        if (index < 0) return
        val current = pending[index]
        pending[index] = current.copy(attempts = current.attempts + 1)
    }

    fun nextDelayMs(attempts: Int): Long {
        var delay = 2_000L
        repeat(attempts.coerceAtMost(5)) { delay *= 2 }
        return delay.coerceAtMost(60_000L)
    }
}
