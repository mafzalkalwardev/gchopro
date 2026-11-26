package com.gchopro.gateway

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

object Store {
    private const val FILE = "gchopro.gateway"
    private const val LEGACY = "simdesk"

    fun prefs(context: Context): SharedPreferences {
        val master = MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
        val secure = EncryptedSharedPreferences.create(
            context,
            FILE,
            master,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
        val legacy = context.getSharedPreferences(LEGACY, Context.MODE_PRIVATE)
        if (legacy.all.isNotEmpty() && secure.getString("deviceId", "").isNullOrEmpty()) {
            val editor = secure.edit()
            legacy.all.forEach { (key, value) ->
                when (value) {
                    is String -> editor.putString(key, value)
                    is Long -> editor.putLong(key, value)
                    is Boolean -> editor.putBoolean(key, value)
                    is Int -> editor.putInt(key, value)
                }
            }
            editor.apply()
            legacy.edit().clear().apply()
        }
        return secure
    }

    fun baseUrl(context: Context) = prefs(context).getString("baseUrl", "") ?: ""
    fun deviceId(context: Context) = prefs(context).getString("deviceId", "") ?: ""
    fun token(context: Context) = prefs(context).getString("token", "") ?: ""
    fun ready(context: Context) = deviceId(context).isNotEmpty() && token(context).isNotEmpty()

    fun savePairing(context: Context, baseUrl: String, deviceId: String, token: String) {
        prefs(context).edit()
            .putString("baseUrl", baseUrl)
            .putString("deviceId", deviceId)
            .putString("token", token)
            .apply()
    }

    fun replaceToken(context: Context, token: String) {
        prefs(context).edit().putString("token", token).apply()
    }

    fun clear(context: Context) {
        prefs(context).edit().clear().apply()
    }

    fun lastProviderId(context: Context) = prefs(context).getLong("lastProviderId", 0L)

    fun setLastProviderId(context: Context, id: Long) {
        prefs(context).edit().putLong("lastProviderId", id).apply()
    }

    fun sentIds(context: Context): Set<String> {
        val raw = prefs(context).getString("sentIds", "") ?: ""
        if (raw.isBlank()) return emptySet()
        return raw.split(",").toSet()
    }

    fun rememberSent(context: Context, id: String) {
        val kept = (sentIds(context) + id).toList().takeLast(500)
        prefs(context).edit().putString("sentIds", kept.joinToString(",")).apply()
    }
}
