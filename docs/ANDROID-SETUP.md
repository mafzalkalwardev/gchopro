# Android gateway

The gateway application id is `com.gchopro.gateway`. It is not distributed on the Play Store. Install a release APK that you signed.

## Permissions

The app asks for:

- `INTERNET`
- `SEND_SMS`, `RECEIVE_SMS`, and `READ_SMS` (inbox sync needs `READ_SMS`)
- `READ_PHONE_STATE` and `READ_PHONE_NUMBERS`
- `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_DATA_SYNC`, and `POST_NOTIFICATIONS`
- `RECEIVE_BOOT_COMPLETED` and `WAKE_LOCK`
- `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`

On Android 13 and newer the activity also requests notification permission. On Android 15 and newer, restricted settings may block the SMS role until the operator allows the app in system settings.

## Battery

Turn off battery optimization for the gateway. A manufacturer battery saver that freezes the process will stop heartbeats, and the desk will mark the phone offline after `health.offline_after_seconds` (seeded at 90).

## SMS limiter

Android's own SMS limiter is about 30 messages in 30 minutes. The default policy allows about 50 messages an hour on a SIM. The phone's limiter is tighter than that policy. When Android shows the limit prompt, the app reports `sms_limit_prompt_shown`. That is a handset limit, not a reason to move the SIM's queue.

## Signed release

CI runs `assembleDebug` and does not sign a release. To sign one, create a keystore outside the repo (`*.jks` and `*.keystore` are gitignored):

```text
keytool -genkeypair -alias gchopro -keyalg RSA -keysize 2048 -validity 3650 -keystore gchopro.jks
```

Then, in `android/`:

```text
GCHOPRO_KEYSTORE=/path/to/gchopro.jks
GCHOPRO_KEYSTORE_PASSWORD=...
GCHOPRO_KEY_ALIAS=gchopro
GCHOPRO_KEY_PASSWORD=...
./gradlew assembleRelease
```

The APK is under `android/app/build/outputs/apk/release/`. Without those variables, `assembleRelease` stays unsigned and `assembleDebug` is unchanged.

## On a phone

These checks are for a person with the handset. They are not claimed by CI.

- [ ] Pairing succeeds and both SIM slots appear.
- [ ] A portal send is delivered from the assigned SIM.
- [ ] An inbound SMS appears on the portal thread.
- [ ] Denying battery optimization shows the phone offline after the heartbeat window.
- [ ] Restricted settings on Android 15 still allow the SMS role after the operator allows the app.
