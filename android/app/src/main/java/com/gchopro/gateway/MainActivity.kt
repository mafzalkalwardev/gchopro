package com.gchopro.gateway

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.TextView

class MainActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        val status = findViewById<TextView>(R.id.status)
        val baseUrl = findViewById<EditText>(R.id.baseUrl)
        val code = findViewById<EditText>(R.id.pairingCode)
        val name = findViewById<EditText>(R.id.deviceName)
        baseUrl.setText(Store.baseUrl(this))
        refresh(status)
        findViewById<Button>(R.id.register).setOnClickListener {
            val url = baseUrl.text.toString().trim()
            val cleartextLab = BuildConfig.DEBUG && url.startsWith("http://")
            if (!url.startsWith("https://") && !cleartextLab) {
                status.text = "The gateway address must be HTTPS."
                return@setOnClickListener
            }
            requestPermissions()
            status.text = "Pairing"
            Thread {
                try {
                    val version = packageManager.getPackageInfo(packageName, 0).versionName ?: "2.0.0"
                    val result = DeskClient.register(
                        url,
                        code.text.toString().trim(),
                        name.text.toString().trim().ifBlank { "Handset" },
                        Build.MODEL,
                        Build.VERSION.SDK_INT,
                        version,
                    )
                    Store.savePairing(this, url, result.getString("id"), result.getString("token"))
                    runOnUiThread {
                        refresh(status)
                        GatewayService.start(this)
                    }
                } catch (error: Exception) {
                    runOnUiThread { status.text = error.message ?: "Pairing failed" }
                }
            }.start()
        }
    }

    override fun onResume() {
        super.onResume()
        if (Store.ready(this)) GatewayService.start(this)
        refresh(findViewById(R.id.status))
    }

    private fun refresh(status: TextView) {
        status.text = if (Store.ready(this)) {
            "Paired. This phone is reporting its SIMs."
        } else {
            getString(R.string.unpaired)
        }
    }

    private fun requestPermissions() {
        val needed = mutableListOf(
            Manifest.permission.SEND_SMS,
            Manifest.permission.RECEIVE_SMS,
            Manifest.permission.READ_SMS,
            Manifest.permission.READ_PHONE_STATE,
            Manifest.permission.READ_PHONE_NUMBERS,
        )
        if (Build.VERSION.SDK_INT >= 33) needed.add(Manifest.permission.POST_NOTIFICATIONS)
        val missing = needed.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isNotEmpty()) requestPermissions(missing.toTypedArray(), 1)
    }
}
