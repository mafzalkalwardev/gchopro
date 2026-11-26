package com.gchopro.gateway

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class GatewayLogicTest {
    @Test
    fun resultNamesAndUnknownCodes() {
        assertEquals("RESULT_ERROR_NO_SERVICE", resultName(4))
        assertEquals("RESULT_ERROR_LIMIT_EXCEEDED", resultName(5))
        assertEquals("UNKNOWN_999", resultName(999))
        assertEquals("delivered", deliveryEvent(0))
        assertEquals("delivery_pending", deliveryEvent(32))
        assertEquals("delivery_failed", deliveryEvent(64))
        assertEquals("LOCAL_SUBSCRIPTION_NOT_ACTIVE", localRefusal(false))
        assertNull(localRefusal(true))
    }

    @Test
    fun segmentBoundaries() {
        assertEquals(128, gsmBasicSize())
        assertEquals(1, countSegments("a".repeat(160)).segments)
        assertEquals(2, countSegments("a".repeat(161)).segments)
        assertEquals(2, countSegments("€").units)
        assertEquals(1, countSegments("你".repeat(70)).segments)
        assertEquals(2, countSegments("你".repeat(71)).segments)
        assertEquals(2, countSegments("😀".repeat(36)).segments)
        val boundary = countSegments("a".repeat(152) + "€" + "a".repeat(8))
        assertEquals("gsm7", boundary.encoding)
        assertEquals(2, boundary.segments)
    }

    @Test
    fun reportOutboxRetriesThenAcknowledges() {
        val outbox = ReportOutbox()
        outbox.enqueue(
            PendingReport("m1", "sent", 0, 1, 3, -1, "RESULT_OK"),
        )
        assertEquals(2_000L, outbox.nextDelayMs(0))
        assertEquals(60_000L, outbox.nextDelayMs(8))
        outbox.markAttempt("m1", "sent", 0)
        assertEquals(1, outbox.pending().single().attempts)
        outbox.acknowledge("m1", "sent", 0)
        assertEquals(0, outbox.pending().size)
    }

    @Test
    fun simInventoryKeepsActiveSubscriptions() {
        val report = inventory(
            2,
            listOf(
                SubscriptionSnapshot(3, 0, false, "Jazz", "SIM 1", "+923001234567", "pk", "410", "01", "SIM_STATE_READY", "STATE_IN_SERVICE", 3, true),
                SubscriptionSnapshot(4, 1, false, "Zong", "SIM 2", "", "pk", "410", "04", "SIM_STATE_READY", "OUT_OF_SERVICE", 0, true),
                SubscriptionSnapshot(9, 2, false, "Old", "SIM 3", null, null, null, null, null, null, null, false),
            ),
        )
        assertEquals(2, report.slotsOnDevice)
        assertEquals(listOf(3, 4), report.sims.map { it.subscriptionId })
        assertEquals("", report.sims[1].number)
    }
}
