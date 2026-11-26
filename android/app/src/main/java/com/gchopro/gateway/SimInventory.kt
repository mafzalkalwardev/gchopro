package com.gchopro.gateway

data class SubscriptionSnapshot(
    val subscriptionId: Int,
    val slotIndex: Int,
    val embedded: Boolean,
    val carrierName: String?,
    val displayName: String?,
    val number: String?,
    val countryIso: String?,
    val mcc: String?,
    val mnc: String?,
    val simState: String?,
    val serviceState: String?,
    val signalLevel: Int?,
    val active: Boolean,
)

data class SimReport(val slotsOnDevice: Int, val sims: List<SubscriptionSnapshot>)

fun inventory(slotsOnDevice: Int, sims: List<SubscriptionSnapshot>): SimReport {
    return SimReport(
        slotsOnDevice = slotsOnDevice,
        sims = sims.filter { it.active }.sortedBy { it.slotIndex },
    )
}
