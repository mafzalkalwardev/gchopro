package com.gchopro.gateway

import android.content.Context
import android.os.Build
import android.telephony.SubscriptionInfo
import android.telephony.SubscriptionManager
import android.telephony.TelephonyManager
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant

object SimReader {
    fun report(context: Context): JSONObject {
        val telephony = context.getSystemService(TelephonyManager::class.java)
        val subscriptions = context.getSystemService(SubscriptionManager::class.java)
        val slots = if (Build.VERSION.SDK_INT >= 30) telephony.activeModemCount else telephony.phoneCount
        val active = subscriptions.activeSubscriptionInfoList ?: emptyList()
        val snapshots = active.map { info -> snapshot(telephony, info) }
        val inventory = inventory(slots, snapshots)
        val sims = JSONArray()
        inventory.sims.forEach { sim ->
            sims.put(
                JSONObject()
                    .put("subscriptionId", sim.subscriptionId)
                    .put("slotIndex", sim.slotIndex)
                    .put("isEmbedded", sim.embedded)
                    .put("carrierName", sim.carrierName)
                    .put("displayName", sim.displayName)
                    .put("mcc", sim.mcc)
                    .put("mnc", sim.mnc)
                    .put("countryIso", sim.countryIso)
                    .put("number", sim.number ?: "")
                    .put("simState", sim.simState)
                    .put("serviceState", sim.serviceState)
                    .put("signalLevel", sim.signalLevel),
            )
        }
        return JSONObject()
            .put("reportedAt", Instant.now().toString())
            .put("slotsOnDevice", inventory.slotsOnDevice)
            .put("sims", sims)
    }

    private fun snapshot(telephony: TelephonyManager, info: SubscriptionInfo): SubscriptionSnapshot {
        val specific = telephony.createForSubscriptionId(info.subscriptionId)
        return SubscriptionSnapshot(
            subscriptionId = info.subscriptionId,
            slotIndex = info.simSlotIndex,
            embedded = Build.VERSION.SDK_INT >= 28 && info.isEmbedded,
            carrierName = info.carrierName?.toString(),
            displayName = info.displayName?.toString(),
            number = info.number,
            countryIso = info.countryIso,
            mcc = if (Build.VERSION.SDK_INT >= 29) info.mccString else null,
            mnc = if (Build.VERSION.SDK_INT >= 29) info.mncString else null,
            simState = simStateName(specific.simState),
            serviceState = serviceName(specific.serviceState?.state),
            signalLevel = null,
            active = true,
        )
    }

    private fun simStateName(state: Int): String = when (state) {
        TelephonyManager.SIM_STATE_ABSENT -> "SIM_STATE_ABSENT"
        TelephonyManager.SIM_STATE_PIN_REQUIRED -> "SIM_STATE_PIN_REQUIRED"
        TelephonyManager.SIM_STATE_PUK_REQUIRED -> "SIM_STATE_PUK_REQUIRED"
        TelephonyManager.SIM_STATE_NETWORK_LOCKED -> "SIM_STATE_NETWORK_LOCKED"
        TelephonyManager.SIM_STATE_READY -> "SIM_STATE_READY"
        TelephonyManager.SIM_STATE_NOT_READY -> "SIM_STATE_NOT_READY"
        TelephonyManager.SIM_STATE_PERM_DISABLED -> "SIM_STATE_PERM_DISABLED"
        TelephonyManager.SIM_STATE_CARD_IO_ERROR -> "SIM_STATE_CARD_IO_ERROR"
        TelephonyManager.SIM_STATE_CARD_RESTRICTED -> "SIM_STATE_CARD_RESTRICTED"
        else -> "SIM_STATE_UNKNOWN"
    }

    private fun serviceName(state: Int?): String = when (state) {
        0 -> "STATE_IN_SERVICE"
        1 -> "OUT_OF_SERVICE"
        2 -> "EMERGENCY_ONLY"
        3 -> "POWER_OFF"
        else -> "OUT_OF_SERVICE"
    }
}
