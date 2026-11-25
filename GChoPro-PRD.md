# GChoPro: Product Requirements Document (PRD)

- **Product:** GChoPro, a Multi-SIM SMS Messaging Platform
- **Document type:** Build specification for an AI coding agent (Cursor Agent) and the developer supervising it
- **Version:** 1.0, 25 November 2026
- **Existing gateway repository (reference implementation):** https://github.com/mafzalkalwardev/sim-desk (reviewed at commit `7d0493b`)

> **How to use this document.** This is the single source of truth for the build. Build in the milestone order in §24. Every feature has acceptance criteria in §22. Where this PRD makes a decision, follow it. Where something is genuinely ambiguous, use the default in §26 and record it in `PROGRESS.md`. Do not invent scope.

---

## 1. Overview

GChoPro is a secure web platform for sending and receiving SMS through physical SIM cards in Android phones that the operator owns. It has three runtime parts plus a phone app:

1. **Admin panel** (`apps/admin`). The administrator:
   - pairs gateway phones
   - sees every SIM and its health
   - creates user accounts and binds **one SIM to each user**
   - manages passwords, subscriptions, sending policies, translation settings, opt-outs, alerts, analytics and audit logs
2. **User portal** (`apps/portal`). Users sign in with credentials the admin issued, then send and receive SMS from their assigned SIM only. This includes one-to-one and group sends, with optional Chinese↔English translation. The portal also hosts the **device API** that gateway phones call. A dedicated hostname exposes only the `/api/devices/*` paths.
3. **Worker** (`apps/worker`). This background service runs the paced per-SIM send queues (BullMQ), health evaluation, subscription expiry, alerts, analytics roll-ups, retention purges and backups orchestration.
4. **GChoPro Android gateway app** (`android/`). This is a fork and extension of the existing sim-desk gateway (`dev.simdesk.gateway`), upgraded to multi-SIM, hardened, and moved to protocol v2.

The existing sim-desk project already proves the core transport:

- pairing a phone with a one-time code
- a per-device bearer token stored only as a hash
- the phone polling for pending messages and sending them through `SmsManager`
- the phone reporting sent, delivered or failed
- the phone mirroring its SMS store to the server
- a heartbeat

GChoPro keeps that protocol shape (§9) and extends it.

## 2. Goals and non-goals

### 2.1 Goals

- Multi-device, multi-SIM gateway with **one SIM = one user**, plus capacity tracking (users created vs free SIMs).
- Admin-issued user accounts. The admin can reset any password at any time, which **instantly revokes every session** of that user.
- Subscriptions by day, week, month or year. They can be paused or disabled at any time, and access is blocked on expiry.
- A paced per-SIM send queue with an admin-configurable gap and jitter, per-user per-minute, per-hour and per-day caps, send windows, segment-aware counting, a global kill switch, and bounded retries on the same SIM only.
- SIM health monitoring: failure codes and SIM or service state are mapped to health states. A suspected suspension auto-pauses the SIM and alerts the admin. Recovery is manual, with a re-test.
- Chinese↔English translation, set per user. Both the original and the translated text are stored.
- Per-user and per-SIM analytics: sent, received, delivered, failed, delivery ratio, delivery time.
- Security as the top priority:
  - argon2id password hashing and TOTP 2FA for admins
  - field-level AES-256-GCM encryption, CSP and CSRF protection, Zod validation, rate limiting
  - an admin IP allowlist and an append-only audit log
  - device-token hashing and rotation, and no secrets in the repo
- Compliance by design: STOP/退订 opt-out handling, opt-out blocking, consent source on contacts, and an optional sender signature.

### 2.2 Non-goals

- **No features to evade carrier spam or fraud detection.** That means:
  - no "human-like" traffic disguise
  - no rotating SIMs to dodge blocks
  - no automatic "unblocking" or recovery of suspended SIMs
  - no failover of a blocked SIM's traffic to another SIM

  Pacing and limits exist to stay within carrier fair-use policies and to protect deliverability.
- No online payment gateway. Payments are recorded by hand (`payments_log`).
- No Google Play distribution. The gateway is sideloaded because of SMS permission policy.
- No becoming the default SMS app on the phone.
- No WhatsApp, MMS, RCS or voice. SMS text only.
- No self-registration of users.
- No public bulk-send API in v1. The per-user API keys and webhooks feature (F20) is a later, optional milestone and is not built unless enabled in §26.

## 3. Glossary

| Term | Meaning |
| --- | --- |
| Device / gateway | An Android phone running the GChoPro gateway app, paired to the server. |
| SIM | One active subscription on a device, identified on the phone by `subscriptionId` and `simSlotIndex`. Stored in table `sims`. |
| subscriptionId (subId) | Android's integer ID for an active SIM subscription (`SubscriptionInfo.getSubscriptionId()`). It can change if a SIM is re-inserted. |
| Slot | The physical or eSIM slot index (`SubscriptionInfo.getSimSlotIndex()`). |
| User | A portal account bound to exactly one SIM. |
| Admin | An administrator account using the admin panel. |
| Subscription | A user's paid access period (day, week, month or year). Not to be confused with the Android SIM subscription. |
| Policy | A `rate_limit_policies` row: gap, jitter, caps, send window. |
| Gap | The minimum wait between two sends on the same SIM. Effective gap = base ± jitter. |
| Segment | One SMS PDU. GSM-7 fits 160 characters (153 per part when multipart). UCS-2 fits 70 (67 per part when multipart). |
| Lease / dispatch | The moment the worker hands one queued message to a device. The message becomes `dispatched`, and a lease expiry protects against double sends. |
| Kill switch | A global, per-device or per-SIM stop on all dispatching. |
| Opt-out | A number that replied STOP, 退订 or similar, or was added by the admin. Sends to it are blocked. |
| Blind index | An HMAC-SHA256 of a normalized phone number. It allows equality lookups on encrypted numbers. |

## 4. Existing gateway: what is already built (sim-desk, commit `7d0493b`)

The developer must read the sim-desk repo before starting M2. Facts the GChoPro build relies on:

**Server (Next.js App Router, SQLite via Drizzle, `better-sqlite3`):**

| Method and path | Auth | Request | Response | Notes |
| --- | --- | --- | --- | --- |
| `POST /api/devices/pairing` | `x-operator-key` header | none | `{ id, code, expiresAt }` | Inserts a `devices` row with `status='pairing'`, `pairingCodeHash=sha256(code)`, a 6-digit code and a 10-minute expiry. |
| `POST /api/devices/register` | none (pairing code) | `{ code: "123456", name?: string }` | `{ id, token, name }` | Matches `status='pairing'` and the code hash, not expired. Sets `status='active'` and `tokenHash=sha256(token)`, where token = 32 random bytes as hex. |
| `GET /api/devices` | operator | none | `{ devices: DeviceView[] }` | `online` = heartbeat under 90 s old. |
| `POST /api/devices/:id/heartbeat` | `Authorization: Bearer <token>` | `{ battery?: number, lineNumber?: string, carrier?: string }` | `DeviceView` | Stores battery, line number and carrier, but only for the **default SMS subscription**. |
| `GET /api/devices/:id/pending` | Bearer | none | `{ messages: MessageView[] }` | Returns **all** `queued` outbound rows for the device. The status stays `queued` until reported, so there is a **double-send risk** if a poll lands before the report. GChoPro fixes this with leases. |
| `POST /api/devices/:id/report` | Bearer | `{ id, status: "sent"\|"delivered"\|"failed", error?: string }` | `MessageView` | Status rank `queued<failed<sent<delivered<received`, and never downgrades except to `failed`. |
| `POST /api/devices/:id/inbox` | Bearer | `{ messages: [{ providerId, address, body, direction: "in"\|"out" }] }` | `{ inserted }` | Dedupes on `providerId` **globally**. That is a bug once several devices exist, because Android `_ID` values collide across phones. GChoPro dedupes per `(device_id, provider_id)`. |
| `POST /api/devices/:id/line` | operator | `{ lineNumber }` | `DeviceView` | Sets the number by hand. |
| `GET /api/messages`, `POST /api/messages` | operator | `{ to: string[]\|string, body, deviceId? }` | `{ messages }` | At most 5 recipients, 10 sends a minute, 1000 characters. |
| `GET /api/session` | LAN host only | none | `{ key }` | Returns the operator key on LAN hosts. **Not carried into GChoPro.** |

- **DB tables:** `devices(id, name, status, pairing_code_hash, pairing_expires_at, token_hash, last_heartbeat, battery, adb_serial, line_number, carrier, created_at)` and `messages(id, device_id, direction, address, body, status, provider_id, error, created_at, updated_at)`.
- **Helpers:**
  - `src/lib/auth.ts`: `hashSecret` (SHA-256), `newToken` (32 bytes as hex), and a timing-safe compare of the operator key.
  - `src/lib/address.ts`: canonicalization with a Pakistan-specific `92` prefix. **Replace it with `libphonenumber-js`.**

**Android app (`android/`, package `dev.simdesk.gateway`, Kotlin, minSdk 26, target/compile 34):**

- `GatewayService`: a foreground service of type `dataSync`. Every **3 s** it runs `cycle()`, which sends a heartbeat, uploads new SMS-store rows, fetches pending messages and sends **all of them immediately** (no pacing on the phone).
- `SmsSender`:
  - `SmsManager` from `getSystemService(SmsManager)` on API 31+, or `getDefault()` below that. Either way it is **the default subscription only**.
  - Splits long text with `divideMessage` and `sendMultipartTextMessage`.
  - Uses sent and delivered `PendingIntent`s.
- `SmsStatusReceiver`: maps `resultCode == RESULT_OK` to `sent` or `delivered`. Anything else becomes `failed` with error text `"carrier result <code>"`. The numeric code is not sent as a structured field.
- `InboxReader`: reads `Telephony.Sms.CONTENT_URI` rows with `_ID > lastProviderId` (columns `_ID, ADDRESS, BODY, TYPE`). It **does not read `sub_id`**, so inbound messages cannot be attributed to a SIM.
- `LineNumber`: reads `SubscriptionManager.getDefaultSmsSubscriptionId()` only.
- `Store`: plain `SharedPreferences` (`baseUrl`, `deviceId`, `token`, `lastProviderId`). The token is **not encrypted at rest**.
- `WakeReceiver`: an **exported** broadcast receiver (`dev.simdesk.gateway.WAKE`) with no permission guard. `BootReceiver` restarts the service after a reboot.
- **Manifest:**
  - Has `INTERNET`, `SEND_SMS`, `RECEIVE_SMS`, `READ_PHONE_STATE`, `READ_PHONE_NUMBERS`, `FOREGROUND_SERVICE(_DATA_SYNC)`, `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED` and `WAKE_LOCK`.
  - **`READ_SMS` is not declared**, even though `InboxReader` needs it. The runbook grants it with `pm grant`. Declare it explicitly.
  - `android:usesCleartextTraffic="true"`. **This must be removed.**

GChoPro must keep the device API **path shapes** (`/api/devices/register`, `/api/devices/:id/{heartbeat,pending,report,inbox}`) for continuity. It changes the payloads to protocol v2 (§9) and adds new device endpoints. The operator-key routes (`/api/devices/pairing`, `GET /api/devices`, `/api/devices/:id/line`, `/api/messages`, `/api/session`) are **replaced** by session-authenticated admin routes (§10).

## 5. Roles and permissions

Roles: `admin` and `user`. A `device` is a non-human principal. v1 has a single admin role. All admins are equal, and a `super_admin` flag is reserved for later (§26).

| Capability | Admin | User | Device |
| --- | --- | --- | --- |
| Sign in to the admin panel (IP allowlist + 2FA) | ✔ | ✘ | ✘ |
| Sign in to the user portal | ✘ | ✔ (active subscription, not disabled) | ✘ |
| Pair, rename, retire a device; rotate or revoke its token | ✔ | ✘ | ✘ |
| View all devices and SIMs and their health | ✔ | ✘ | ✘ |
| Pause, resume or re-test a SIM | ✔ | ✘ | ✘ |
| Create, edit or disable users; assign or reassign a SIM | ✔ | ✘ | ✘ |
| Reset any user's password (revokes sessions) | ✔ | ✘ | ✘ |
| Change own password | ✔ | ✔ (unless the admin disabled it) | ✘ |
| Manage subscriptions and payments log | ✔ | view own | ✘ |
| Manage rate-limit policies, assign policies | ✔ | view own limits and usage | ✘ |
| Set a user's translation languages | ✔ | ✘ (view only) | ✘ |
| Send SMS (one-to-one, group) | ✘ (except the SIM re-test message) | ✔ own SIM only | ✘ |
| Read conversations | read-only support view, if enabled (§26), audit-logged | own only | ✘ |
| Contacts, groups, personal templates, quick replies | ✘ | ✔ own | ✘ |
| Shared templates | ✔ | use | ✘ |
| Opt-out list (global) | ✔ full | ✘ (opt-outs apply automatically) | ✘ |
| Analytics | all users and SIMs | own usage only | ✘ |
| Alerts, audit log, settings, kill switch, notices | ✔ | read notices | ✘ |
| Export | ✔ stats and audit | own conversations, if `allow_export` | ✘ |
| Heartbeat, SIM report, fetch dispatched, report status, upload inbox | ✘ | ✘ | ✔ own device only |

**Enforcement rules:**

1. Every server query for user data is scoped by `user_id = session.userId` **in the data-access layer** (`packages/core`), never only in the UI.
2. Device routes resolve the device from the bearer token and then check that `:id` matches it.
3. Admin routes require: a valid admin session, `mfa_verified = true`, a source IP in `ADMIN_IP_ALLOWLIST`, and a request to the `ADMIN_HOST` hostname.

## 6. Data model (PostgreSQL 16, Drizzle ORM)

**Conventions:**

- Primary keys are `uuid` (`uuidv7()` generated in the app, via the `uuidv7` package), except `audit_logs` (`bigserial`) and `settings` (text key).
- All timestamps are `timestamptz`. Every table has `created_at default now()` and, where mutable, an `updated_at` maintained by Drizzle `$onUpdate`.
- Columns ending in `_enc` hold AES-256-GCM ciphertext as `text`, in the format `v1:<keyId>:<base64 iv>:<base64 ciphertext+tag>` (§18.4).
- Columns ending in `_hash` on phone numbers are blind indexes: `hex(HMAC-SHA256(INDEX_KEY, e164))`.
- Phone numbers are normalized to E.164 with `libphonenumber-js` before hashing or encrypting. The default region for parsing local numbers is `settings.default_region` (default `PK`).
- Enums are PostgreSQL enums created through Drizzle `pgEnum`.
- Migrations: `drizzle-kit generate`, committed under `packages/db/migrations`. Never use `push` in production.

### 6.1 `users`

| Column | Type | Constraints / notes |
| --- | --- | --- |
| id | uuid | PK |
| role | enum `user_role('admin','user')` | not null |
| username | citext | unique, not null, 3–40 characters `[a-z0-9._-]` |
| display_name | text | not null |
| password_hash | text | argon2id encoded string |
| password_changed_at | timestamptz | not null |
| must_change_password | boolean | default true for admin-created users |
| allow_self_password_change | boolean | default true |
| status | enum `user_status('active','disabled')` | default `active` |
| totp_secret_enc | text | null; required for admins once 2FA is enrolled |
| totp_enabled | boolean | default false |
| totp_last_used_step | bigint | null; blocks replay of TOTP codes |
| recovery_codes_hash | text[] | argon2id hashes of 10 one-time codes |
| sim_id | uuid | FK → sims.id, **unique**, null for admins and unassigned users |
| rate_limit_policy_id | uuid | FK → rate_limit_policies.id, null = default policy |
| user_language | enum `lang('zh','en')` | default `en`; the language the user reads and writes |
| recipient_language | enum `lang` | default `en`; the language recipients receive |
| translation_enabled | boolean | default false |
| timezone | text | IANA zone, default `settings.default_timezone` |
| allow_export | boolean | default true |
| ip_allowlist | cidr[] | null = any |
| failed_login_count | int | default 0 |
| locked_until | timestamptz | null |
| last_login_at | timestamptz | null |
| aup_accepted_at | timestamptz | null; set when the user accepts the Acceptable Use terms (§19.3) |
| created_by | uuid | FK users.id null |
| created_at, updated_at | timestamptz | |
| deleted_at | timestamptz | soft delete |

Indexes: `unique(username)`, `unique(sim_id) where sim_id is not null`, `(role, status)`.
Check: `role='admin' → sim_id is null`.

### 6.2 `sessions`

| Column | Type | Notes |
| --- | --- | --- |
| id | text | PK = hex(SHA-256(session token)). The raw token exists only in the cookie. |
| user_id | uuid | FK users, `on delete cascade`, indexed |
| app | enum `session_app('admin','portal')` | |
| mfa_verified | boolean | admin sessions must be true to access anything beyond the 2FA screens |
| ip | inet | |
| user_agent | text | truncated to 300 characters |
| created_at | timestamptz | |
| last_seen_at | timestamptz | updated at most once a minute |
| expires_at | timestamptz | portal: 12 h idle and 7 d absolute; admin: 30 min idle and 12 h absolute |
| absolute_expires_at | timestamptz | |
| revoked_at | timestamptz | null |
| revoke_reason | enum `revoke_reason('logout','password_reset','password_change','user_disabled','subscription_inactive','admin_revoke','sim_unassigned','expired')` | |

Indexes: `(user_id) where revoked_at is null`, `(expires_at)`.

### 6.3 `devices`

| Column | Type | Notes |
| --- | --- | --- |
| id | uuid | PK |
| name | text | default `'Handset'` |
| status | enum `device_status('pairing','active','retired')` | |
| pairing_code_hash | text | HMAC-SHA256 with `TOKEN_PEPPER`; null after registration |
| pairing_expires_at | timestamptz | 10 minutes |
| pairing_attempts | int | default 0; invalidate after 5 attempts |
| token_hash | text | HMAC-SHA256(`TOKEN_PEPPER`, token); unique where not null |
| token_prev_hash | text | accepted until `token_prev_expires_at` (rotation grace period) |
| token_prev_expires_at | timestamptz | |
| token_rotated_at | timestamptz | |
| protocol_version | int | 1 = legacy sim-desk, 2 = GChoPro |
| app_version | text | |
| model | text | for example from `Build.MANUFACTURER + MODEL` |
| android_sdk | int | |
| last_heartbeat_at | timestamptz | |
| battery | smallint | 0–100 |
| charging | boolean | |
| network | enum `device_network('wifi','cellular','none','unknown')` | |
| sms_rate_limit_note | text | free text from setup, for example "Android SMS limiter raised" |
| paused | boolean | default false; device-level kill switch |
| created_at, retired_at | timestamptz | |

Indexes: `(status)`, `unique(token_hash)`, `unique(token_prev_hash)`.

### 6.4 `sims`

| Column | Type | Notes |
| --- | --- | --- |
| id | uuid | PK |
| device_id | uuid | FK devices, not null |
| slot_index | smallint | from `SubscriptionInfo.getSimSlotIndex()`; -1 if unknown |
| subscription_id | int | Android subId; may change, see reconciliation below |
| is_embedded | boolean | eSIM |
| carrier_name | text | |
| display_name | text | |
| mcc_mnc | text | from `SubscriptionInfo.getMccString()+getMncString()` (API 29+) |
| country_iso | text | |
| phone_number_enc | text | null |
| phone_number_hash | text | unique where not null |
| number_source | enum `number_source('device','admin')` | |
| active_on_device | boolean | true if present in the active subscription list in the latest report |
| health | enum `sim_health('active','no_service','absent','locked','suspected_suspended','error','paused_admin','inactive','retired')` | see §14 |
| health_reason | text | short machine reason, for example `RESULT_ERROR_LIMIT_EXCEEDED` |
| health_changed_at | timestamptz | |
| sim_state | text | last raw `TelephonyManager.SIM_STATE_*` name |
| service_state | text | `STATE_IN_SERVICE` / `OUT_OF_SERVICE` / `EMERGENCY_ONLY` / `POWER_OFF` |
| signal_level | smallint | 0–4 (`SignalStrength.getLevel()`) |
| consecutive_failures | int | default 0 |
| last_send_ok_at, last_receive_at, last_failure_at | timestamptz | |
| last_failure_code | int | |
| last_failure_name | text | |
| paused_by_admin | boolean | default false |
| paused_reason | text | |
| inbound_enabled | boolean | default true; the admin's inbound control per SIM (§26 #3) |
| next_send_at | timestamptz | the pacing gate |
| rate_limit_policy_id | uuid | FK, optional SIM-level policy (the stricter of SIM and user wins) |
| created_at, updated_at, retired_at | timestamptz | |

Constraints: `unique(device_id, subscription_id) where retired_at is null`, `unique(device_id, slot_index) where retired_at is null and active_on_device`.

**Reconciliation rule.** When a device reports its SIM list, match existing rows in this order:

1. `(device_id, subscription_id)`
2. otherwise `(device_id, slot_index, carrier_name, phone_number_hash)`
3. otherwise create a new row

Rows missing from the report become `active_on_device=false` and `health='inactive'`. They are never deleted, so history is kept. A user's assignment stays on the `sims.id`. If an assigned SIM is inactive, the portal shows "line unavailable".

### 6.5 `sim_events`
Columns:

- `id uuid PK`
- `sim_id FK`
- `at timestamptz`
- `kind enum('state_report','health_change','send_failure','admin_pause','admin_resume','retest_started','retest_passed','retest_failed')`
- `from_health`, `to_health`
- `detail jsonb`

Index `(sim_id, at desc)`.

### 6.6 `subscriptions`

| Column | Type | Notes |
| --- | --- | --- |
| id | uuid | PK |
| user_id | uuid | FK users, indexed |
| plan_unit | enum `plan_unit('day','week','month','year')` | |
| plan_quantity | int | ≥ 1 |
| starts_at | timestamptz | |
| ends_at | timestamptz | computed from unit and quantity in the user's timezone (date-fns-tz); may be edited by the admin |
| status | enum `sub_status('scheduled','active','paused','expired','disabled')` | §12 |
| paused_at | timestamptz | |
| paused_remaining_seconds | bigint | used on resume |
| expiry_behavior | enum `expiry_behavior('block','read_only')` | default `block` |
| reminder_sent_at | timestamptz | the 3-days-before reminder (F5) |
| notes | text | |
| created_by | uuid | FK users |
| created_at, updated_at | timestamptz | |

Constraint: at most one row per user with status in (`scheduled`, `active`, `paused`) whose period overlaps another. Enforce in core logic, and add a partial unique index `(user_id) where status in ('active','paused')`.

### 6.7 `conversations`
Columns:

- `id uuid PK`
- `user_id FK`
- `sim_id FK`
- `peer_number_enc text`
- `peer_number_hash text`
- `peer_country text`
- `contact_id uuid null FK contacts`
- `last_message_at timestamptz`
- `last_preview_enc text`
- `unread_count int default 0`
- `archived boolean default false`
- `tags text[] default '{}'`
- `created_at`, `updated_at`

Indexes: `unique(user_id, peer_number_hash)`, `(user_id, last_message_at desc)`, GIN on `tags`.

### 6.8 `messages`

| Column | Type | Notes |
| --- | --- | --- |
| id | uuid | PK; also the ID the device echoes in reports |
| conversation_id | uuid | FK |
| user_id | uuid | FK (denormalized for scoping) |
| sim_id | uuid | FK |
| device_id | uuid | FK |
| direction | enum `direction('out','in')` | |
| peer_number_hash | text | |
| wire_body_enc | text | the exact text sent or received over SMS |
| wire_lang | enum `lang` null | detected or declared |
| encoding | enum `sms_encoding('gsm7','ucs2')` | |
| segments | smallint | |
| status | enum `msg_status('scheduled','queued','held','dispatched','sent','delivered','failed','blocked','cancelled','received')` | §13 |
| hold_reason | enum `hold_reason('rate_minute','rate_hour','rate_day','window','sim_unhealthy','kill_switch','subscription','device_offline','translation_pending')` | null |
| block_reason | enum `block_reason('opted_out','content_rule','subscription_inactive','user_disabled','no_sim','invalid_number')` | null |
| failure_code | int | Android result code |
| failure_name | text | constant name, for example `RESULT_ERROR_NO_SERVICE` |
| failure_class | enum `failure_class('transient','sim_problem','suspension_signal','permanent','unknown')` | §14 |
| attempts | smallint | default 0; max per §13.6 |
| group_send_id | uuid | null FK group_sends |
| template_id | uuid | null |
| scheduled_for | timestamptz | null |
| queued_at, dispatched_at, lease_expires_at, sent_at, delivered_at, failed_at, received_at | timestamptz | |
| provider_id | text | Android `Telephony.Sms._ID`, for inbound or mirrored rows |
| parts_sent, parts_delivered | smallint | multipart aggregation |
| idempotency_key | text | unique, for client resubmits |
| is_retest | boolean | default false; admin SIM re-test, not counted in user stats |
| created_at, updated_at | timestamptz | |

Indexes:

- `(conversation_id, created_at desc)`
- `(user_id, created_at desc)`
- `(sim_id, status)`
- `(status, scheduled_for) where status='scheduled'`
- `(device_id, status) where status='dispatched'`
- `unique(device_id, provider_id) where provider_id is not null`
- `unique(idempotency_key)`

### 6.9 `message_translations`
Columns:

- `id uuid PK`
- `message_id uuid FK messages on delete cascade`
- `role enum('outbound_original','inbound_display')`
- `source_lang lang`, `target_lang lang`
- `source_text_enc text`, `translated_text_enc text`
- `provider enum('deepl','google','libretranslate','none')`
- `provider_model text`
- `characters int`
- `latency_ms int`
- `error text`
- `created_at`

Constraint: `unique(message_id, role)`.

**Semantics:**

- **Outbound with translation:** the user typed Chinese. `outbound_original.source_text` is the Chinese text, `translated_text` is the English text, and `messages.wire_body_enc` is the English text.
- **Inbound with translation:** `wire_body_enc` is the received English, and the `inbound_display` row holds its Chinese translation for the user.

### 6.10 `group_sends`
Columns:

- `id uuid PK`
- `user_id FK`
- `name text`
- `body_template_enc text`
- `recipient_count int`
- `blocked_count int`
- `status enum('queued','in_progress','completed','cancelled')`
- `created_at`, `completed_at`

### 6.11 `contacts`, `contact_groups`, `contact_group_members`
`contacts` columns:

- `id uuid PK`
- `user_id FK`
- `name_enc text`
- `number_enc text`
- `number_hash text`
- `consent_source enum('existing_customer','verbal','written','web_form','imported_with_consent','other')` **not null**
- `consent_note text`
- `consent_at timestamptz`
- `tags text[]`
- `created_at`, `updated_at`

Constraint: `unique(user_id, number_hash)`.

The other two tables:

- `contact_groups(id, user_id, name, created_at)`, with `unique(user_id, name)`
- `contact_group_members(group_id, contact_id)`, PK on both columns

### 6.12 `opt_outs`
Columns:

- `id uuid PK`
- `number_hash text not null`
- `scope enum('global','user')`
- `user_id uuid null`
- `source enum('keyword','admin','import')`
- `keyword text`
- `source_message_id uuid null`
- `created_at`
- `reversed_at timestamptz null`
- `reversed_by uuid null`
- `reverse_reason text`

Index: `unique(number_hash, scope, coalesce(user_id, '00000000-0000-0000-0000-000000000000')) where reversed_at is null`.

### 6.13 `templates`
Columns:

- `id uuid PK`
- `owner_user_id uuid null` (null = shared, created by an admin)
- `name text`
- `body text`
- `variables text[]`
- `lang lang null`
- `kind enum('template','quick_reply')`
- `created_by`
- `created_at`, `updated_at`

Constraint: `unique(owner_user_id, name)`.

### 6.14 `rate_limit_policies`

| Column | Type | Default (the "Conservative" seed policy) |
| --- | --- | --- |
| id | uuid | |
| name | text unique | `Conservative (default)` |
| is_default | boolean | true (exactly one row; partial unique index `where is_default`) |
| gap_base_seconds | int | 15 |
| gap_jitter_seconds | int | 5 (check: `0 ≤ jitter ≤ base/2`) |
| per_minute | int | 3 |
| per_hour | int | 50 |
| per_day | int | 300 |
| segments_per_day | int | 400 |
| max_group_recipients | int | 50 |
| window_start | time | 09:00 |
| window_end | time | 20:00 |
| window_days | smallint[] | {1,2,3,4,5,6,7} (ISO weekdays) |
| window_timezone_mode | enum('user','fixed') | `user` |
| window_timezone | text | null |
| over_limit_action | enum('hold','reject') | `hold` |
| created_at, updated_at, updated_by | | |

Checks:

- `gap_base_seconds >= settings.min_gap_floor_seconds` (default floor 5, enforced in core because the floor lives in `settings`)
- `per_minute ≤ 60 / max(gap_base - jitter, 1)` is advisory; the UI warns when it is impossible
- every cap ≥ 1

### 6.15 `audit_logs`
Columns:

- `id bigserial PK`
- `at timestamptz default now()`
- `actor_user_id uuid null`
- `actor_role text`
- `actor_ip inet`
- `actor_kind enum('admin','user','device','system')`
- `action text` (dot notation, for example `user.password_reset`)
- `target_type text`, `target_id text`
- `before jsonb`, `after jsonb` (secrets and bodies **redacted**)
- `request_id text`
- `prev_hash text`
- `hash text` (`sha256(prev_hash || canonical_json(row))`, a hash chain for tamper evidence)

Index `(at desc)`, `(target_type, target_id)`, `(actor_user_id, at desc)`. The app DB role has `INSERT, SELECT` only (§18.10).

### 6.16 `alerts`
Columns:

- `id uuid PK`
- `type enum('device_offline','device_battery_low','device_app_stopped','sim_state_change','sim_suspected_suspended','sim_failure_spike','queue_backlog','kill_switch_changed','subscription_expiring','backup_failed','backup_restore_test','login_anomaly','translation_provider_error')`
- `severity enum('info','warning','critical')`
- `device_id`, `sim_id`, `user_id` (all nullable)
- `title text`
- `detail jsonb`
- `dedupe_key text`
- `created_at`
- `acknowledged_at`, `acknowledged_by`
- `resolved_at`
- `notified_channels text[]`

Index: `unique(dedupe_key) where resolved_at is null`.

### 6.17 `payments_log`
Columns:

- `id uuid PK`
- `user_id FK`
- `subscription_id FK null`
- `amount_minor bigint` (check ≥ 0)
- `currency char(3)`
- `method text`
- `reference text`
- `paid_at timestamptz`
- `notes text`
- `recorded_by uuid FK`
- `created_at`
- `voided_at`, `voided_by`, `void_reason`

### 6.18 `notices` (F13)
Columns:

- `id uuid PK`
- `title text`
- `body text`
- `audience enum('all','selected')`
- `user_ids uuid[]`
- `starts_at`, `ends_at`
- `created_by`
- `created_at`

Plus `notice_reads(notice_id, user_id, read_at)`.

### 6.19 `stats_daily` (analytics roll-up)
Columns:

- `day date`
- `user_id uuid null`
- `sim_id uuid`
- `sent int`, `delivered int`, `failed int`, `received int`, `blocked int`
- `segments_out int`
- `opt_outs int`
- `delivery_ms_sum bigint`, `delivery_ms_count int`
- `limit_holds int`

PK `(day, sim_id, coalesce(user_id, nil-uuid))`. The worker upserts into it (§16).

### 6.20 `settings`
`key text PK`, `value jsonb not null`, `updated_at`, `updated_by`.

Keys and their seed defaults:

| Key | Default |
| --- | --- |
| `kill_switch` | `{"enabled":false,"reason":null,"since":null}` |
| `min_gap_floor_seconds` | `5` |
| `default_policy_id` | (seed id) |
| `default_timezone` | `"Asia/Karachi"` |
| `default_region` | `"PK"` |
| `translation` | `{"provider":"none","deepl":{"plan":"free"},"google":{},"libretranslate":{"url":null},"preview_before_send":true}` |
| `opt_out_keywords` | `["STOP","STOPALL","UNSUBSCRIBE","CANCEL","END","QUIT","退订","取消","停止","TD"]` |
| `opt_in_keywords` | `["START","UNSTOP","订阅"]` |
| `opt_out_scope` | `"global"` |
| `opt_out_confirmation` | `{"enabled":true,"text_en":"You have been unsubscribed and will not receive further messages.","text_zh":"您已退订，将不会再收到消息。"}` |
| `sender_signature` | `{"enabled":false,"text":""}` |
| `content_rules` | `{"blocked_keywords":[],"block_urls":false}` |
| `health` | `{"consecutive_failure_threshold":3,"suspension_signal_threshold":2,"offline_after_seconds":90,"battery_low_percent":20}` |
| `alerts` | `{"email":{"enabled":false,"to":[]},"telegram":{"enabled":false,"chat_id":null}}` |
| `retention` | `{"message_body_days":180,"audit_days":730}` |
| `portal` | `{"expiry_behavior_default":"block","allow_admin_support_view":false}` |
| `branding` | `{"product_name":"GChoPro"}` |

## 7. Multi-SIM handling on the gateway (Android app changes)

Fork `android/` from sim-desk into `android/` in the GChoPro monorepo:

- Rename the application ID to `com.gchopro.gateway`. Keep the Kotlin package structure, renaming it is optional.
- Set `minSdk 26`, and `targetSdk/compileSdk 34` (35 allowed).
- Every change below is mandatory.

### 7.1 SIM discovery (new `SimInventory.kt`, replaces `LineNumber.kt`)

- Get `SubscriptionManager` from `context.getSystemService(SubscriptionManager::class.java)`.
- `getActiveSubscriptionInfoList()` (needs `READ_PHONE_STATE`) gives, for each `SubscriptionInfo`:
  - `subscriptionId`, `simSlotIndex`, `isEmbedded`
  - `carrierName`, `displayName`
  - `mccString`/`mncString` (API 29+), `countryIso`
- Number:
  - API 33+: `subscriptionManager.getPhoneNumber(subId)` (needs `READ_PHONE_NUMBERS`)
  - below that: `info.number`
  - Send an empty string if it is blank; the admin enters the number by hand.
- Per SIM, `telephonyManager.createForSubscriptionId(subId)` gives:
  - `simState` (`getSimState(slotIndex)` on API 26–28; on API 29+ `getSimState()` of the per-subscription manager or `getSimCardState`)
  - `serviceState?.state` (needs `READ_PHONE_STATE`; on API 31+ also register a `TelephonyCallback.ServiceStateListener`)
  - `signalStrength?.level` (API 28+)
- Register `SubscriptionManager.OnSubscriptionsChangedListener`. On change, immediately POST a SIM report (§9.4).
- Also report `activeModemCount` (API 30+) or `phoneCount` (`TelephonyManager`), so the admin can see "slots on device" against "active SIMs".

### 7.2 Sending per SIM (`SmsSender.kt`)

- Replace `manager(context)` with `managerFor(subId: Int)`:
  - API 31+: `context.getSystemService(SmsManager::class.java).createForSubscriptionId(subId)`
  - API 26–30: `SmsManager.getSmsManagerForSubscriptionId(subId)`
- `send(context, dispatch: Dispatch)`, where `Dispatch` has `messageId, subscriptionId, slotIndex, address, body`. **Before sending**, verify that `subscriptionId` is still in the active list. If it is not, report `failed` with `failureName = "LOCAL_SUBSCRIPTION_NOT_ACTIVE"` and do not send.
- Keep `divideMessage` / `sendMultipartTextMessage`.
- PendingIntent extras: `messageId`, `partIndex`, `partCount`, `subscriptionId`. Request codes must be unique per (message, part, kind). Use a stable hash of `"$messageId:$kind:$part"` and also keep a monotonic counter in `Store` to avoid collisions.
- Send **one dispatched message at a time, in the order received**. The server controls pacing, and the phone must never batch-send.

### 7.3 Status reporting (`SmsStatusReceiver.kt`)

- For SENT intents:
  - `resultCode == Activity.RESULT_OK` → part sent.
  - Otherwise → part failed. Map the code to its `SmsManager.RESULT_*` constant name with a `when` table, covering every constant available at the compile SDK. Unknown values become `"UNKNOWN_<code>"`.
  - Include `intent.getIntExtra("errorCode", -1)` (the radio error code) when present.
- For DELIVERED intents: parse the `pdu` extra with `SmsMessage.createFromPdu(pdu, format)` and read `status`.
  - `status == 0` → delivered.
  - `status >= 64` → permanent failure.
  - 32–63 → temporary; report as `delivery_pending`, and **do not** mark failed.
- Report per part. The server aggregates: a message is `sent` when all parts are sent, `delivered` when all parts are delivered, and `failed` if any part fails.
- Reports go into a **durable on-device outbox**: a `reports` table with `RoomDatabase` or simple SQLite. Retries use exponential backoff from 2 s up to 60 s, so a network blip never loses a status.

### 7.4 Inbound attribution (`InboxReader.kt`, new `SmsReceivedReceiver.kt`)

- Add `READ_SMS` to the manifest (missing today).
- `InboxReader`:
  - Also select `Telephony.Sms.SUBSCRIPTION_ID` (column `sub_id`, API 22+) and `Telephony.Sms.DATE`.
  - Include `subscriptionId` and `receivedAt` in each row.
  - Only `MESSAGE_TYPE_INBOX` rows are sent by default. `MESSAGE_TYPE_SENT` mirroring stays optional and is off by default, because GChoPro creates outbound rows itself.
- New `SmsReceivedReceiver` for `android.provider.Telephony.SMS_RECEIVED` (permission `BROADCAST_SMS`, `exported=true` as Android requires):
  - On receive, read the `subscription` extra (`SubscriptionManager.EXTRA_SUBSCRIPTION_INDEX` on API 30+, otherwise `"subscription"`).
  - Trigger an immediate inbox sync, using `WorkManager` with an expedited one-time work request, so inbound latency is not bound to the poll.
  - The content-provider read stays the source of truth, which keeps dedupe by `_ID`.

### 7.5 Device security and lifecycle

- Remove `android:usesCleartextTraffic="true"`. Add a `network_security_config.xml` that allows HTTPS only.
- Certificate pinning is optional (§26 default: off). When on, pin to the SPKI hash of the intermediate CA from a build config field.
- Store `deviceId` and `token` in `EncryptedSharedPreferences` (androidx.security:security-crypto) backed by an Android Keystore master key. Migrate the old prefs on first start, then delete them.
- `WakeReceiver`: set `android:exported="false"`, or protect it with a signature-level custom permission. The adb wake feature from sim-desk (`SIMDESK_WAKE`) is **not** used in GChoPro.
- Token rotation: handle `X-Gateway-Rotate: 1` on any response by calling `POST /api/devices/:id/token/rotate` (§9.7), then storing the new token atomically.
- On HTTP 401 with `{"error":"device_revoked"}`: stop the loop, clear the credentials, and show "Device unpaired. Pair again."
- Setup screen (`MainActivity`): server URL (HTTPS only), pairing code, device name. Plus a checklist of granted permissions, battery optimisation exemption (`ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`), notification permission and "Allow restricted settings" guidance for Android 15+.
- Poll loop:
  - Interval 3 s while there is dispatched work or the server returned `pollAgainMs`; otherwise 10 s.
  - Heartbeat every 30 s.
  - SIM report on change, and every 5 minutes.
  - Keep the foreground service `dataSync` and add a `WakeLock` only during the send itself.
- Collect `Build.MANUFACTURER`, `Build.MODEL`, `Build.VERSION.SDK_INT`, the app `versionName`, charging state and network type (`ConnectivityManager`) for the heartbeat.
- **Release:**
  - Sign the APK with a release keystore kept outside the repo, loaded through `keystore.properties` (gitignored).
  - Publish a SHA-256 checksum of the APK alongside it.
  - Build with `./gradlew assembleRelease` and R8 enabled.

### 7.6 Android unit tests (JUnit)

- `ResultCodeMapper` maps every constant and unknown values.
- `SegmentCounter` (shared logic with the server) handles GSM-7 and UCS-2 boundaries.
- `ReportOutbox` retries until acknowledged.
- `SimInventory` reconciliation is exercised with fake `SubscriptionInfo` lists, using Robolectric or plain fakes.

## 8. Server-side changes to the sim-desk device API (summary)

| sim-desk today | GChoPro change |
| --- | --- |
| `POST /api/devices/pairing` (operator key) | Replaced by the admin route `POST /api/admin/devices/pairings` (session + 2FA). The code is still 6 digits with a 10-minute expiry, but hashed with HMAC (`TOKEN_PEPPER`). After 5 failed attempts the pairing is invalidated. |
| `POST /api/devices/register` `{code,name}` → `{id,token,name}` | **Same path.** v2 body adds `{ protocolVersion: 2, appVersion, model, androidSdk }`. The response adds `{ protocolVersion: 2, pollIntervalMs, heartbeatIntervalMs }`. Rate limit: 10 a minute per IP. |
| `POST /api/devices/:id/heartbeat` `{battery,lineNumber,carrier}` | **Same path.** v2 body is in §9.3. `lineNumber` and `carrier` move to the SIM report. v1 fields are accepted and ignored when `protocolVersion=2`. |
| *(none)* | **New:** `POST /api/devices/:id/sims`, the full SIM inventory and state (§9.4). |
| `GET /api/devices/:id/pending` returns all `queued` | **Same path.** Returns only messages **already dispatched to this device** by the worker (status `dispatched`, lease not expired), one per SIM at most, in `dispatched_at` order. Each item includes `subscriptionId` and `slotIndex`. A message whose lease expires without a report is resolved by the worker (§13.5). |
| `POST /api/devices/:id/report` `{id,status,error}` | **Same path.** v2 body is per part, with a structured failure code and name (§9.6). A batch form is also accepted. |
| `POST /api/devices/:id/inbox` with global `providerId` dedupe | **Same path.** v2 rows carry `subscriptionId` and `receivedAt`. Dedupe is per `(device_id, provider_id)`, and each row is routed to the SIM, then the user, then the conversation. |
| `POST /api/devices/:id/line` (operator) | Replaced by `PATCH /api/admin/sims/:simId` `{ phoneNumber }`. |
| `GET/POST /api/messages` (operator) | Replaced by the portal routes in §10.2 and the admin read-only views. |
| `GET /api/session` (LAN key disclosure) | **Removed.** |
| *(none)* | **New:** `POST /api/devices/:id/token/rotate` and `POST /api/devices/:id/events` (§9.7, §9.8). |

Device API middleware for all `/api/devices/*` routes except `register`:

1. Read the `Authorization: Bearer <token>`.
2. Compute `HMAC(TOKEN_PEPPER, token)` and look up `devices.token_hash`, or `token_prev_hash` if `now < token_prev_expires_at`.
3. Require `status='active'` and `id == :id`. Otherwise return 401 `device_revoked`, or 403 on an ID mismatch.
4. Rate limit 120 requests a minute per device.
5. Require the `X-Gateway-Protocol: 2` header, and respond with `X-Gateway-Rotate: 1` when the token is older than `DEVICE_TOKEN_MAX_AGE_DAYS` (default 30).
6. Treat `register` from a v1 (sim-desk) app as unsupported. Return 426 `upgrade_required`, because GChoPro needs per-SIM data.

## 9. Device-to-server protocol v2

All requests and responses are JSON over HTTPS. Times are ISO-8601 UTC strings. Every request carries `X-Gateway-Protocol: 2`. Every request body is validated with a Zod schema in `packages/core/src/device/schemas.ts`, which is the single source for both the server and the generated Kotlin data classes (write them by hand, mirroring the schema). Unknown fields are stripped.

### 9.1 Register
`POST /api/devices/register`
```json
{ "code": "483920", "name": "Rack A - Phone 3", "protocolVersion": 2, "appVersion": "2.0.0", "model": "Infinix X6528", "androidSdk": 34 }
```
→ 200
```json
{ "id": "0193...", "token": "<64 hex>", "name": "Rack A - Phone 3", "protocolVersion": 2, "pollIntervalMs": 3000, "heartbeatIntervalMs": 30000 }
```
Errors: 400 `invalid_code_format`, 404 `pairing_not_found` (also for expired or exhausted codes), 426 `upgrade_required`, 429.

### 9.2 Common error shape
`{ "error": "<machine_code>", "message": "<safe human text>" }`. Never include stack traces or internal identifiers.

### 9.3 Heartbeat
`POST /api/devices/:id/heartbeat`
```json
{ "battery": 76, "charging": true, "network": "wifi", "appVersion": "2.0.0", "androidSdk": 34, "activeModemCount": 2, "uptimeSec": 81234 }
```
→ 200
```json
{ "serverTime": "2026-11-25T10:00:00Z", "paused": false, "pollIntervalMs": 3000, "requestSimReport": false }
```
The server sets `requestSimReport=true` when it has no SIM report newer than 5 minutes.

### 9.4 SIM report
`POST /api/devices/:id/sims`
```json
{
  "reportedAt": "2026-11-25T10:00:00Z",
  "slotsOnDevice": 2,
  "sims": [
    { "subscriptionId": 3, "slotIndex": 0, "isEmbedded": false, "carrierName": "Jazz", "displayName": "SIM 1",
      "mcc": "410", "mnc": "01", "countryIso": "pk", "number": "+923001234567",
      "simState": "SIM_STATE_READY", "serviceState": "STATE_IN_SERVICE", "signalLevel": 3 },
    { "subscriptionId": 4, "slotIndex": 1, "isEmbedded": false, "carrierName": "Zong", "displayName": "SIM 2",
      "mcc": "410", "mnc": "04", "countryIso": "pk", "number": "",
      "simState": "SIM_STATE_READY", "serviceState": "OUT_OF_SERVICE", "signalLevel": 0 }
  ]
}
```
→ 200 `{ "sims": [{ "subscriptionId": 3, "simId": "0193...", "health": "active" }, ...] }`

The server reconciles the list (§6.4), writes `sim_events`, and re-evaluates health (§14).

### 9.5 Fetch dispatched work
`GET /api/devices/:id/pending`
→ 200
```json
{ "messages": [ { "id": "0193...", "subscriptionId": 3, "slotIndex": 0, "address": "+8613800138000", "body": "Hello", "segments": 1, "leaseExpiresAt": "2026-11-25T10:02:00Z" } ], "pollAgainMs": 3000 }
```

- A message is returned only while `status='dispatched'` and the lease is valid.
- The device must remember the IDs it has handed to `SmsManager` (`Store.sentIds`, keeping the last 500), so a re-delivered ID is never sent twice.
- Re-delivery can only happen after a crash before the device reported. The device reports `sent` for an ID it has already sent.

### 9.6 Report status
`POST /api/devices/:id/report` (single) or with `{ "reports": [ ... ] }` (batch, up to 50).
```json
{ "id": "0193...", "event": "sent", "partIndex": 0, "partCount": 2, "subscriptionId": 3,
  "resultCode": 4, "resultName": "RESULT_ERROR_NO_SERVICE", "radioErrorCode": -1, "at": "2026-11-25T10:00:05Z" }
```

- `event` is one of: `sent`, `failed`, `delivered`, `delivery_failed`, `delivery_pending`.
- → 200 `{ "ok": true, "status": "sent" }`. The response gives the aggregated message status.
- The call is idempotent per `(id, event, partIndex)`.

### 9.7 Token rotation
`POST /api/devices/:id/token/rotate` → 200 `{ "token": "<new 64 hex>" }`

- The server moves the current hash to `token_prev_hash` with a 10-minute grace period, and stores the new hash.
- An admin can force a rotation (the next heartbeat gets `X-Gateway-Rotate: 1`) or revoke the token (`status='retired'`, which returns 401 `device_revoked`).

### 9.8 Device events
`POST /api/devices/:id/events`
```json
{ "events": [ { "kind": "permission_missing", "detail": { "permission": "SEND_SMS" }, "at": "..." }, { "kind": "service_restarted", "at": "..." } ] }
```
Kinds: `permission_missing`, `service_restarted`, `battery_optimization_on`, `sms_limit_prompt_shown`, `app_updated`. These feed alerts (§17).

### 9.9 Inbox
`POST /api/devices/:id/inbox`
```json
{ "messages": [ { "providerId": "8812", "subscriptionId": 4, "address": "+8613800138000", "body": "STOP", "direction": "in", "receivedAt": "2026-11-25T10:01:00Z" } ] }
```
→ 200 `{ "inserted": 1, "duplicates": 0, "unroutable": 0 }`

For each row, the server:

1. Normalizes the address.
2. Resolves `sims` by `(device_id, subscription_id)`. If the subscription is unknown, it inserts the message with `user_id=null` into an `unroutable` admin queue and creates an alert.
3. Finds the user by `users.sim_id`.
4. Upserts the conversation by `(user_id, peer_number_hash)`.
5. Inserts the message with `status='received'`.
6. Runs opt-out keyword detection (§19.1).
7. Translates for display if enabled (§15).
8. Publishes the `message.received` real-time event.

## 10. REST and route list

**Conventions:**

- JSON route handlers under the Next.js App Router (`app/api/**/route.ts`). Server Actions may be used for forms, but each must call the same `packages/core` service functions and Zod schemas.
- Every response uses `{ data }` or `{ error, message }`.
- Pagination is cursor-based: `?cursor=<opaque>&limit=50` (max 100), returning `{ data, nextCursor }`.
- All mutating requests require the CSRF header (§18.3).
- Times are ISO strings.
- IDs are UUIDs.
- Admin app base: `https://<ADMIN_HOST>/api/admin/*`. Portal app base: `https://<PORTAL_HOST>/api/portal/*`. Device API: `https://<GATEWAY_HOST>/api/devices/*`, served by `apps/portal`; the reverse proxy exposes only this prefix on that host.

### 10.1 Admin API (`apps/admin`)

**Auth**

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| POST | `/api/admin/auth/login` | `{ username, password }` | `{ data: { mfaRequired: true, enrollRequired: boolean } }`. Sets a session cookie with `mfa_verified=false`. |
| POST | `/api/admin/auth/totp/enroll` | none | `{ data: { otpauthUrl, qrSvg } }` (only while not enrolled) |
| POST | `/api/admin/auth/totp/verify` | `{ code }` or `{ recoveryCode }` | `{ data: { ok: true, recoveryCodes?: string[] } }`. Recovery codes are shown once, at enrollment. |
| POST | `/api/admin/auth/logout` | none | 204 |
| GET | `/api/admin/auth/me` | none | `{ data: { id, username, displayName } }` |
| POST | `/api/admin/auth/password` | `{ currentPassword, newPassword }` | 204. Revokes the admin's other sessions. |

**Dashboard**

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| GET | `/api/admin/dashboard` | none | `{ data: { devices: {total, online, offline}, sims: {total, active, byHealth: Record<health, n>}, users: {total, active, disabled}, capacity: {simsAvailableForAssignment, usersCreated}, queue: {queued, held, dispatched}, alerts: {open, critical}, killSwitch } }` |

**Devices**

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| GET | `/api/admin/devices` | `?status=` | `{ data: DeviceDTO[] }`. `DeviceDTO = { id, name, status, online, lastHeartbeatAt, battery, charging, network, appVersion, model, androidSdk, slotsOnDevice, sims: SimSummary[] , paused }` |
| POST | `/api/admin/devices/pairings` | `{ name? }` | `{ data: { deviceId, code, expiresAt, gatewayUrl } }` |
| GET | `/api/admin/devices/:id` | none | `{ data: DeviceDTO & { events: DeviceEvent[] } }` |
| PATCH | `/api/admin/devices/:id` | `{ name?, paused?, smsRateLimitNote? }` | `{ data: DeviceDTO }` |
| POST | `/api/admin/devices/:id/rotate-token` | none | 202 (applied at the next heartbeat) |
| POST | `/api/admin/devices/:id/retire` | `{ confirm: "RETIRE" }` | `{ data: DeviceDTO }`. Revokes the token, marks its SIMs retired, unassigns users (revoking their sessions with reason `sim_unassigned`), and moves held messages to `cancelled`. |

**SIMs**

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| GET | `/api/admin/sims` | `?health=&deviceId=&assigned=true\|false` | `{ data: SimDTO[] }`. `SimDTO = { id, deviceId, deviceName, slotIndex, subscriptionId, carrierName, phoneNumber, numberSource, health, healthReason, healthChangedAt, signalLevel, serviceState, simState, consecutiveFailures, lastSendOkAt, lastReceiveAt, assignedUser: {id, username} \| null, usageToday: {sent, segments}, policyId }` |
| GET | `/api/admin/sims/:id` | none | `{ data: SimDTO & { events: SimEvent[], stats7d } }` |
| PATCH | `/api/admin/sims/:id` | `{ phoneNumber?, rateLimitPolicyId? \| null }` | `{ data: SimDTO }` |
| POST | `/api/admin/sims/:id/pause` | `{ reason }` | `{ data: SimDTO }` |
| POST | `/api/admin/sims/:id/resume` | none | `{ data: SimDTO }`. Allowed only from `paused_admin`. For `suspected_suspended`, use retest. |
| POST | `/api/admin/sims/:id/retest` | `{ testNumber }` (must be in `ADMIN_TEST_NUMBERS` or `settings.test_numbers`) | `{ data: { messageId } }`. Sends one message ("GChoPro line test <time>") with `is_retest=true`, bypassing user caps but **not** the gap or the kill switch. On `delivered` or `sent`, health becomes `active`; on failure it stays put. |
| GET | `/api/admin/capacity` | none | `{ data: { devices: [{ deviceId, name, slotsOnDevice, activeSims, assignedSims, freeSims }], totals: { slots, activeSims, assigned, free, usersWithoutSim } } }` |

**Users**

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| GET | `/api/admin/users` | `?q=&status=&subscription=active\|expiring\|expired&cursor` | `{ data: UserDTO[] }`. `UserDTO = { id, username, displayName, status, sim: SimSummary \| null, subscription: SubscriptionDTO \| null, policyId, userLanguage, recipientLanguage, translationEnabled, timezone, lastLoginAt, activeSessions }` |
| POST | `/api/admin/users` | `{ username, displayName, password? (generated if absent, 16 chars), simId?, policyId?, userLanguage, recipientLanguage, translationEnabled, timezone, allowExport, allowSelfPasswordChange, ipAllowlist?, subscription?: { planUnit, planQuantity, startsAt? } }` | `{ data: { user: UserDTO, initialPassword?: string } }`. The generated password is shown once. |
| GET | `/api/admin/users/:id` | none | `{ data: UserDTO & { sessions: SessionDTO[], usage: UsageDTO, subscriptions: SubscriptionDTO[] } }` |
| PATCH | `/api/admin/users/:id` | any editable field above except the password | `{ data: UserDTO }` |
| POST | `/api/admin/users/:id/reset-password` | `{ newPassword? }` | `{ data: { initialPassword?: string } }`. **Revokes all sessions (§11)** and sets `must_change_password=true`. |
| POST | `/api/admin/users/:id/disable` | `{ reason }` | `{ data: UserDTO }`. Revokes all sessions and holds queued messages as `blocked/user_disabled`. |
| POST | `/api/admin/users/:id/enable` | none | `{ data: UserDTO }` |
| POST | `/api/admin/users/:id/assign-sim` | `{ simId \| null }` | `{ data: UserDTO }`. The SIM must be unassigned and not retired. Reassigning revokes sessions (`sim_unassigned`) and cancels queued messages on the old SIM. |
| POST | `/api/admin/users/:id/revoke-sessions` | none | 204 |
| GET | `/api/admin/users/:id/support-view/conversations` | (only if `settings.portal.allow_admin_support_view`) | read-only. **Each call is audit-logged** (`support_view.read`). |

**Subscriptions and payments**

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| GET | `/api/admin/subscriptions` | `?status=&expiringWithinDays=` | `{ data: SubscriptionDTO[] }` |
| POST | `/api/admin/users/:id/subscriptions` | `{ planUnit, planQuantity, startsAt?, expiryBehavior? }` | `{ data: SubscriptionDTO }` |
| POST | `/api/admin/subscriptions/:id/extend` | `{ planUnit, planQuantity }` or `{ endsAt }` | `{ data }` |
| POST | `/api/admin/subscriptions/:id/pause` | none | `{ data }` |
| POST | `/api/admin/subscriptions/:id/resume` | none | `{ data }` |
| POST | `/api/admin/subscriptions/:id/disable` | `{ reason }` | `{ data }`. Revokes sessions when access becomes blocked. |
| POST | `/api/admin/subscriptions/:id/enable` | none | `{ data }` |
| GET/POST | `/api/admin/payments` | POST `{ userId, subscriptionId?, amountMinor, currency, method, reference?, paidAt, notes? }` | list / `{ data: PaymentDTO }` |
| POST | `/api/admin/payments/:id/void` | `{ reason }` | `{ data }` |

**Policies, opt-outs, templates, notices**

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| GET/POST | `/api/admin/policies` | the policy fields from §6.14 | list / created |
| PATCH/DELETE | `/api/admin/policies/:id` | fields | updated. Deleting the default policy, or one in use, returns 409. |
| GET/POST | `/api/admin/opt-outs` | POST `{ number, scope, userId?, note }` | list (numbers decrypted for display, masked by default as `+86 138****8000`) / created |
| POST | `/api/admin/opt-outs/:id/reverse` | `{ reason, evidence }` | `{ data }` |
| GET/POST/PATCH/DELETE | `/api/admin/templates[/:id]` | `{ name, body, kind, lang? }` | shared templates |
| GET/POST/DELETE | `/api/admin/notices[/:id]` | `{ title, body, audience, userIds?, startsAt, endsAt }` | |

**Analytics, alerts, audit, settings**

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| GET | `/api/admin/analytics/overview` | `?from&to&granularity=day\|week\|month` | `{ data: { series: [{ bucket, sent, delivered, failed, received, deliveryRatio, avgDeliverySec }], totals, topFailureReasons: [{ name, count }] } }` |
| GET | `/api/admin/analytics/users/:id` | same | same shape, for one user |
| GET | `/api/admin/analytics/sims/:id` | same | same shape, for one SIM |
| GET | `/api/admin/analytics/leaderboard` | `?from&to&metric=sent\|deliveryRatio\|failed` | `{ data: [{ userId, username, value }] }` |
| GET | `/api/admin/analytics/export.csv` | `?from&to&scope=users\|sims` | CSV stream |
| GET | `/api/admin/alerts` | `?status=open\|acknowledged\|resolved` | list |
| POST | `/api/admin/alerts/:id/ack` | none | `{ data }` |
| GET | `/api/admin/audit` | `?actor&action&target&from&to&cursor` | list |
| GET | `/api/admin/audit/verify` | none | `{ data: { ok, brokenAtId? } }` (verifies the hash chain) |
| GET | `/api/admin/settings` | none | all settings (provider secrets are never returned, only `configured: true`) |
| PATCH | `/api/admin/settings/:key` | `{ value }` | `{ data }`. Validated per key with Zod. |
| POST | `/api/admin/kill-switch` | `{ enabled: boolean, reason }` | `{ data }`. Also exposed as a prominent dashboard control. |
| GET | `/api/admin/events` | SSE | real-time: `device.updated`, `sim.updated`, `alert.created`, `queue.stats` |
| GET | `/api/admin/health` | none | `{ data: { db, redis, worker: { lastBeatAt }, queues } }` |

### 10.2 Portal API (`apps/portal`)

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| POST | `/api/portal/auth/login` | `{ username, password }` | `{ data: { mustChangePassword } }` + session cookie. Returns 403 with `subscription_inactive`, `user_disabled`, `no_sim` or `ip_not_allowed`, each with safe text. |
| POST | `/api/portal/auth/logout` | none | 204 |
| POST | `/api/portal/auth/password` | `{ currentPassword, newPassword }` | 204. Revokes the user's other sessions. 403 if self-change is disabled. |
| GET | `/api/portal/me` | none | `{ data: { username, displayName, line: { phoneNumber, health, available }, subscription: { status, endsAt, daysLeft }, languages: { user, recipient, translationEnabled }, limits: PolicyDTO, usage: { minute, hour, day, segmentsDay } } }` |
| GET | `/api/portal/conversations` | `?q=&filter=unread\|failed\|archived&tag=&cursor` | `{ data: [{ id, peerNumber, contactName, lastMessageAt, lastPreview, unreadCount, tags }] }` |
| GET | `/api/portal/conversations/:id/messages` | `?cursor` | `{ data: [{ id, direction, body (display text), wireBody, original?: { text, lang }, translated?: { text, lang }, status, holdReason, blockReason, failureName, segments, createdAt, sentAt, deliveredAt }] }` |
| POST | `/api/portal/conversations/:id/read` | none | 204 |
| PATCH | `/api/portal/conversations/:id` | `{ archived?, tags? }` | `{ data }` |
| POST | `/api/portal/messages` | `{ to: string (E.164 or local), body, templateId?, variables?, scheduledFor?, idempotencyKey }` | `{ data: { message, conversationId, preview: { wireBody, encoding, segments } } }`. Returns 422 `opted_out`, `outside_window` (if the policy says reject), `limit_reached`, `line_unavailable`, `kill_switch`. |
| POST | `/api/portal/messages/preview` | `{ body, to? }` | `{ data: { wireBody, translated: boolean, encoding, segments, chars, warnings: string[] } }` |
| POST | `/api/portal/group-sends` | `{ name?, recipients: string[] \| { groupId } , body, templateId?, scheduledFor?, idempotencyKey }` | `{ data: { groupSendId, queued, blocked: [{ number, reason }] } }`. `recipients.length ≤ policy.max_group_recipients`. |
| GET | `/api/portal/group-sends/:id` | none | progress |
| POST | `/api/portal/messages/:id/cancel` | none | only while `scheduled`, `queued` or `held` |
| GET/POST/PATCH/DELETE | `/api/portal/contacts[/:id]` | `{ name, number, consentSource, consentNote?, consentAt?, tags? }` | |
| POST | `/api/portal/contacts/import` | multipart CSV (`name,number,consent_source,consent_note,consent_at,tags`), max 5,000 rows, max 1 MB | `{ data: { imported, skippedOptedOut, invalid: [{ row, reason }] } }`. A missing or invalid `consent_source` rejects the row. |
| GET/POST/PATCH/DELETE | `/api/portal/groups[/:id]` | `{ name, contactIds }` | |
| GET/POST/PATCH/DELETE | `/api/portal/templates[/:id]` | `{ name, body, kind }` | own templates and quick replies; shared ones are read-only |
| GET | `/api/portal/scheduled` | none | the user's scheduled messages |
| GET | `/api/portal/usage` | `?from&to` | `{ data: { series, totals } }` (own data only) |
| GET | `/api/portal/notices` | none | active notices; `POST /api/portal/notices/:id/read` |
| GET | `/api/portal/export.csv` | `?conversationId?&from&to` | CSV of own conversations if `allow_export` |
| GET | `/api/portal/events` | SSE | `message.received`, `message.status`, `session.revoked`, `notice.created`, `line.status` |

## 11. Authentication and session revocation

- **Sessions:** custom implementation following the Lucia v3 guide's pattern (the Lucia library itself is deprecated, so do not install it). Use `@oslojs/crypto` and `@oslojs/encoding`.
  - The token is 20 random bytes, base32-encoded.
  - Cookie: `__Host-gcho_admin` or `__Host-gcho_portal`, with `HttpOnly; Secure; SameSite=Strict; Path=/`.
  - The DB stores `sha256(token)` as `sessions.id`.
- **Validation on every request** (middleware plus the `getSession()` helper):
  1. Look up the session by hash.
  2. Check `revoked_at is null`, `expires_at > now`, and `absolute_expires_at > now`.
  3. Load the user. Require `status='active'`, `deleted_at is null` and `password_changed_at <= sessions.created_at`. This last check is a belt-and-braces guard: a session created before the latest password change is invalid even if the revoke write was missed.
  4. **Portal only:** require a subscription with status `active` (or `read_only` behavior, §12) and a `sim_id`.
  5. **Admin only:** require `mfa_verified`, the IP allowlist and the host check.
  6. Slide `expires_at`.
- Cache: a session lookup may be cached in Redis for up to 15 s under `sess:<id>`. **Every revocation deletes the cache key and publishes `session.revoked` on Redis channel `user:<userId>`.**
- **Revocation triggers.** Each one runs a single function, `revokeAllSessions(userId, reason)`, inside the same DB transaction as the change:
  - admin resets a password → `password_reset`
  - user changes their own password → `password_change` (keeps the current session; all others are revoked)
  - user disabled → `user_disabled`
  - subscription expired, disabled or paused with `block` behavior → `subscription_inactive`
  - SIM unassigned or reassigned, or device retired → `sim_unassigned`
  - admin "revoke sessions" → `admin_revoke`
- **Forced logout UX:** the portal keeps an SSE connection to `/api/portal/events`. On `session.revoked`, the client clears state and redirects to `/login?reason=<reason>`. Any API call with a revoked session returns 401 `session_revoked`, and the client redirects the same way. **Target:** logout within 5 s of the admin action while the tab is open, and the next request is rejected in every case.
- **Login protections:**
  - argon2id verify.
  - 5 failures → 15-minute lock (`locked_until`), plus a per-IP limit of 20 a minute (rate-limiter-flexible).
  - A constant-time response for unknown users (verify against a dummy hash).
  - Every login success and failure is audit-logged.
- **Passwords:**
  - At least 12 characters.
  - Rejected if found in the top-10k common list (`packages/core/src/auth/common-passwords.txt`, bundled).
  - Rejected if they equal the username.
  - Admin-generated passwords are 16 characters from a safe alphabet.

## 12. Subscription state machine

States: `scheduled`, `active`, `paused`, `expired`, `disabled`.

```
           create (startsAt > now)          startsAt reached (worker)
  [none] ───────────────────────► scheduled ───────────────────────► active
     │ create (startsAt ≤ now)                                        │  ▲
     └───────────────────────────────────────────────────────────────►│  │ resume (ends_at = now + remaining)
                                                                      │  │
                                        pause (store remaining) ──────┼► paused
                                                                      │
                     ends_at reached (worker, every minute) ──────────┼► expired ──extend──► active
                                                                      │
              disable (admin, from any state) ───────────────────────►┴► disabled ──enable──► active | expired (by ends_at)
```

Rules:

- `extend` on `active` or `expired` sets `ends_at = max(ends_at, now) + period`. When the subscription is expired, its status becomes `active`.
- `ends_at` is computed with `date-fns` `add{Days,Weeks,Months,Years}` in the user's timezone and stored in UTC.
- **Effective access:**
  - `active` → full access.
  - `paused` and `disabled` → blocked; sessions are revoked.
  - `expired` → blocked, or read-only if `expiry_behavior='read_only'`. Read-only means login works, history is viewable, and composing is disabled with a banner. Sends always return 403 `subscription_inactive`.
  - `scheduled` → login is allowed and shows "starts on <date>"; sends are blocked.
- On entering a blocked state:
  - revoke sessions (unless read-only)
  - move the user's `queued` and `held` messages to `blocked/subscription_inactive`
  - write the audit log
- The worker job `subscriptions:tick` runs every 60 s and handles:
  - `scheduled → active`
  - `active → expired`
  - the 3-day reminder (F5: an in-portal notice plus optional email, with `reminder_sent_at` set)
  - the admin "expiring soon" alert digest, once a day at 09:00 `default_timezone`
- Every transition writes `audit_logs` (`subscription.<transition>`).

## 13. Paced send queue

### 13.1 Message lifecycle
```
scheduled ──(scheduled_for reached)──► queued ──► [gates] ──► dispatched ──► sent ──► delivered
                                         │  ▲          │           │           └──► failed (delivery_failed)
                                         ▼  │          │           └──► failed (send failure) ──► (retry? §13.6) ──► queued
                                        held ┘          └──► blocked (opt-out, content rule, subscription, user disabled)
any of scheduled/queued/held ──(user or admin cancel)──► cancelled
```

### 13.2 Queues (BullMQ, `apps/worker`)

| Queue | Purpose |
| --- | --- |
| `send:sim:<simId>` | One queue per SIM. One worker per queue, **concurrency 1**. Created and removed dynamically by the `QueueSupervisor` whenever a SIM becomes assignable or retired. A job is `{ messageId }`, with `jobId = messageId`, which makes it idempotent. |
| `scheduler` | Repeatable jobs: `subscriptions:tick` (60 s), `scheduled-messages:tick` (15 s, moves due `scheduled` rows to `queued` and enqueues them), `leases:sweep` (15 s), `health:evaluate` (30 s), `alerts:device-offline` (30 s), `stats:rollup` (5 min), `retention:purge` (daily 03:00), `backup:run` (daily 02:00, if enabled), `backup:restore-test` (weekly). |
| `translate` | Translation jobs, concurrency 4, with retries (§15). |
| `notify` | Email and Telegram deliveries, concurrency 2, with retries. |

The worker processes **only** `send:sim:*` queues for SIMs where `health='active'`, `active_on_device=true`, the device is active and not paused, and `paused_by_admin=false`. If a SIM leaves that set, its worker is paused (`worker.pause()`) and its jobs stay put. Messages stay `queued` or `held` with `hold_reason='sim_unhealthy'`. **Jobs are never moved to another SIM.**

### 13.3 Gates (evaluated in order for every job)

1. **Kill switch.** Global `settings.kill_switch.enabled`, `devices.paused`, or `sims.paused_by_admin` → `held/kill_switch`. Delay 30 s and re-check.
2. **User and subscription.** User `active` and subscription `active`. Otherwise → `blocked` with reason `user_disabled` or `subscription_inactive`. This is final.
3. **Opt-out.** `opt_outs` has the number (global or this user) → `blocked/opted_out`. Final.
4. **Content rules.** Blocked keywords → `blocked/content_rule`. Final.
5. **Send window.** If now is outside the policy window in the user's timezone (or the fixed one) → `held/window`, delayed until the next window opening plus a random 0–60 s.
6. **Caps.** Atomic Redis check (Lua script in `packages/core/src/ratelimit/caps.lua`) of sliding-window counters for the user: `rl:u:<userId>:m` (60 s), `:h` (3600 s), `:d` (86,400 s), and `seg:u:<userId>:d` (segments). The same counters exist per SIM (`rl:s:<simId>:*`) when the SIM has its own policy. The effective policy is the **stricter value of each field** across the user and SIM policies. If over the limit, `over_limit_action`:
   - `hold` → `held/rate_*`, delayed until the oldest counted entry expires
   - `reject` → `blocked` (reason surfaced as `limit_reached`)

   Counters are incremented **only at dispatch**.
7. **Pacing gap.** If `now < sims.next_send_at` → `job.moveToDelayed(next_send_at)` and throw `DelayedError`.
8. **Device online.** The last heartbeat must be under `health.offline_after_seconds` old. Otherwise → `held/device_offline`, delayed 30 s.
9. **Translation ready.** If translation is enabled and the outbound translation row is missing → `held/translation_pending`, delayed 5 s, then fail into `failed/translation_error` after 3 minutes.

**Dispatch** (in one DB transaction):

- `status='dispatched'`
- `dispatched_at=now`
- `lease_expires_at = now + 120 s`
- `attempts += 1`
- `sims.next_send_at = now + gap`, where `gap = base + uniform(-jitter, +jitter)` seconds, clamped to `≥ settings.min_gap_floor_seconds`

Then increment the cap counters and publish `message.status`. The job then waits for the report: it polls the DB every 2 s, or subscribes to Redis `msg:<id>`, for up to 130 s. It completes on `sent`/`failed`, or on lease expiry (§13.5). Concurrency 1 per SIM guarantees **one message in flight per SIM**.

> Purpose statement, to keep in the code comments and the admin UI help text: *"Pacing and limits keep each SIM within carrier fair-use policies and protect deliverability. They are not a mechanism to disguise traffic or evade carrier controls."*

### 13.4 Segment counting (`packages/core/src/sms/segments.ts`, mirrored in Kotlin)

- **GSM-7 basic set** (the 128 characters of 3GPP TS 23.038), plus the **extension set** `^{}\[~]|€` and form feed, each costing 2 septets.
- If every character is in basic or extension → `gsm7`. Single message ≤ 160 septets. Multipart: 153 septets per segment. Never split an escape pair across segments.
- Otherwise → `ucs2`. Count UTF-16 code units (`str.length`), so an emoji or other surrogate pair costs 2. Single ≤ 70. Multipart: 67 per segment. Never split a surrogate pair.
- Return `{ encoding, units, segments, perSegment, remainingInSegment }`.
- Body limits: maximum 10 segments (1,530 GSM-7 or 670 UCS-2 units). Reject above that with 422 `too_long`.
- Tests: boundary cases at 160/161, 70/71, 153×2, 67×2, extension characters at a boundary, emoji at a boundary, and Chinese text.

### 13.5 Leases and idempotency

- `leases:sweep` finds `dispatched` messages with `lease_expires_at < now` and no report:
  - If the device was offline for the whole lease, mark `failed`, `failure_class='transient'`, `failure_name='LEASE_EXPIRED_DEVICE_OFFLINE'`. It is eligible for retry (§13.6).
  - Otherwise mark `failed/LEASE_EXPIRED` and raise a `warning` alert. It is **not** retried automatically, because the device may have sent it.
- A late `sent` report after a lease expiry still updates the message to `sent`; reports always win.
- The portal `POST /messages` requires an `idempotencyKey` (UUID generated by the client per compose action). A duplicate key returns the original message.

### 13.6 Retries (same SIM only)

- Retry only when `failure_class='transient'` (§14.2) and `attempts < 3`. Back off 60 s, then 5 minutes. The message re-enters `queued` on the **same** `send:sim:<simId>` queue, and every gate applies again.
- **Never retry** `suspension_signal`, `sim_problem` or `permanent` failures. **Never move a message to a different SIM.**
- `delivery_failed` (the carrier accepted the message but delivery failed) is never retried automatically.

### 13.7 Group sends

- Validate the recipients:
  - normalize them
  - dedupe them
  - remove opted-out numbers (reported back as `blocked`)
  - cap at `max_group_recipients`
- Create one `messages` row per recipient, in that recipient's conversation, with a shared `group_send_id`, all enqueued to the user's SIM queue in order.
- Group progress = counts by status. Cancelling a group cancels its messages that are not yet dispatched.

### 13.8 Sender signature and templates

- If `settings.sender_signature.enabled`, append `"\n— " + text` to the wire body. For translated messages, append it after translation. Segment counting includes the signature.
- Template variables: `{name}`, `{first_name}`, `{date}`, `{custom1..3}`. Render with a safe replacer that does not evaluate code. Missing variables → 422 listing the missing names.

### 13.9 Global kill switch

- `POST /api/admin/kill-switch` sets the setting, publishes `killswitch.changed`, pauses all `send:sim:*` workers within 2 s, and creates a critical alert.
- Dispatched messages already on a device cannot be recalled. The UI states this.
- Turning it off resumes the workers. Every gate is re-evaluated.

## 14. SIM health detection

### 14.1 Inputs

- SIM reports (`simState`, `serviceState`, `signalLevel`, presence in the active list)
- send-failure reports (`resultName`)
- heartbeats (device online)
- admin actions

### 14.2 Failure-code classification (`packages/core/src/health/classify.ts`)

| Class | Android `SmsManager` result names (match by name) | Effect |
| --- | --- | --- |
| `transient` | `RESULT_ERROR_GENERIC_FAILURE` (only when `serviceState=STATE_IN_SERVICE`), `RESULT_ERROR_NULL_PDU`, `RESULT_NO_MEMORY`, `RESULT_RIL_NO_MEMORY`, `RESULT_SYSTEM_ERROR`, `RESULT_RIL_SYSTEM_ERR`, `RESULT_MODEM_ERROR`, `RESULT_RIL_MODEM_ERR`, `RESULT_NETWORK_ERROR`, `RESULT_RIL_NETWORK_ERR`, `RESULT_RIL_SMS_SEND_FAIL_RETRY`, `RESULT_INTERNAL_ERROR`, `RESULT_RIL_INTERNAL_ERR`, `RESULT_NO_RESOURCES`, `RESULT_RIL_NO_RESOURCES`, `RESULT_SMS_SEND_RETRY_FAILED`, `RESULT_REMOTE_EXCEPTION`, `LEASE_EXPIRED_DEVICE_OFFLINE` | retry allowed (§13.6); counts toward `consecutive_failures` |
| `sim_problem` | `RESULT_ERROR_RADIO_OFF`, `RESULT_RADIO_NOT_AVAILABLE`, `RESULT_RIL_RADIO_NOT_AVAILABLE`, `RESULT_ERROR_NO_SERVICE`, `RESULT_RIL_SIM_ABSENT`, `RESULT_INVALID_STATE`, `RESULT_RIL_INVALID_STATE`, `RESULT_RIL_INVALID_MODEM_STATE`, `RESULT_RIL_NETWORK_NOT_READY`, `LOCAL_SUBSCRIPTION_NOT_ACTIVE` | no retry; health → `no_service`, `absent` or `error` per the state report |
| `suspension_signal` | `RESULT_ERROR_LIMIT_EXCEEDED`, `RESULT_NETWORK_REJECT`, `RESULT_RIL_NETWORK_REJECT`, `RESULT_OPERATION_NOT_ALLOWED`, `RESULT_RIL_OPERATION_NOT_ALLOWED`, `RESULT_RIL_REQUEST_RATE_LIMITED`, `RESULT_ERROR_FDN_CHECK_FAILURE`, `RESULT_ERROR_SHORT_CODE_NOT_ALLOWED`, `RESULT_ERROR_SHORT_CODE_NEVER_ALLOWED`, `RESULT_RIL_ACCESS_BARRED`, `RESULT_RIL_BLOCKED_DUE_TO_CALL` | no retry; counts toward `suspension_signal_threshold` |
| `permanent` | `RESULT_INVALID_ARGUMENTS`, `RESULT_RIL_INVALID_ARGUMENTS`, `RESULT_INVALID_SMS_FORMAT`, `RESULT_RIL_INVALID_SMS_FORMAT`, `RESULT_ENCODING_ERROR`, `RESULT_RIL_ENCODING_ERR`, `RESULT_INVALID_SMSC_ADDRESS`, `RESULT_RIL_INVALID_SMSC_ADDRESS`, `RESULT_REQUEST_NOT_SUPPORTED`, `RESULT_RIL_REQUEST_NOT_SUPPORTED`, `RESULT_CANCELLED`, `RESULT_RIL_CANCELLED`, `RESULT_NO_DEFAULT_SMS_APP`, `delivery_failed` | no retry; counted as failure only |
| `unknown` | anything else | treated as `transient` for retry purposes, capped at 1 retry |

Use the constants available in the compile SDK. Any listed name that does not exist in the compile SDK must be left out of the Kotlin `when`, which then reports it as `UNKNOWN_<code>`, but kept in the TypeScript map. Verify every name against the `SmsManager` reference for the chosen compile SDK. The table lives in one TypeScript map and one Kotlin `when`, and both are covered by tests.

### 14.3 Health state machine (`sims.health`)
Evaluate in this priority order on every input:

1. `retired` if the device is retired.
2. `paused_admin` if `paused_by_admin`.
3. `inactive` if `active_on_device=false`.
4. `absent` if `simState ∈ {SIM_STATE_ABSENT, SIM_STATE_NOT_READY (>5 min), SIM_STATE_CARD_IO_ERROR}`.
5. `locked` if `simState ∈ {SIM_STATE_PIN_REQUIRED, SIM_STATE_PUK_REQUIRED, SIM_STATE_NETWORK_LOCKED, SIM_STATE_PERM_DISABLED, SIM_STATE_CARD_RESTRICTED}`.
6. `suspected_suspended`. **Sticky: only an admin re-test clears it.** It is entered when either:
   - `suspension_signal` failures reach `health.suspension_signal_threshold` (default 2) within 24 h, or
   - `consecutive_failures ≥ health.consecutive_failure_threshold` (default 3) while `serviceState=STATE_IN_SERVICE` and the signal level is ≥ 1.
7. `no_service` if `serviceState ∈ {OUT_OF_SERVICE, EMERGENCY_ONLY, POWER_OFF}` for over 2 minutes. This clears automatically when the SIM is back in service.
8. `error` if `consecutive_failures ≥ threshold` while not in service, or the device is offline for over 10 minutes. This clears automatically on the next successful send, or when the device comes back online.
9. `active` otherwise.

`consecutive_failures` resets to 0 on any `sent`.

**On entering `suspected_suspended`** (in one transaction, plus side effects):

1. Pause the SIM's queue worker. Its queued messages become `held/sim_unhealthy`, and **nothing is moved to another SIM**.
2. Create a `critical` alert `sim_suspected_suspended`, with the SIM, device, carrier, last failure names and the assigned user. Notify by email and Telegram (§17).
3. The portal shows the assigned user a "Line temporarily unavailable" banner. Compose is disabled.
4. Write `sim_events` and `audit_logs` (actor `system`).

**Recovery (manual only):**

1. The admin resolves the issue with the carrier, outside the platform. The UI shows the guidance: *"Contact the carrier to resolve the restriction (for example account status, balance, fair-use limits). GChoPro does not attempt to bypass carrier restrictions."*
2. The admin clicks **Re-test**, enters a test number they control, and the platform sends one message (§10.1).
3. If the test is `sent` (and `delivered`, if delivery reports are supported), health becomes `active`, the worker resumes, and `held/sim_unhealthy` messages go back to `queued` **in their original order**. A failed test stays in `suspected_suspended`.
4. The admin can also keep the SIM out of service, or unassign the user.

## 15. Translation service

Interface (`packages/core/src/translation/types.ts`):
```ts
export type Lang = "zh" | "en";
export interface TranslationProvider {
  id: "deepl" | "google" | "libretranslate";
  translate(input: { text: string; source: Lang | "auto"; target: Lang }): Promise<{ text: string; detectedSource?: Lang; model?: string; characters: number }>;
  health(): Promise<boolean>;
}
```

**Adapters:**

| Adapter | Endpoint | Auth / env | Language codes | Notes |
| --- | --- | --- | --- | --- |
| `DeepLProvider` | `https://api-free.deepl.com/v2/translate` (free) or `https://api.deepl.com/v2/translate` | `DEEPL_API_KEY`, header `Authorization: DeepL-Auth-Key` | target `ZH-HANS` / `EN-US` | |
| `GoogleProvider` | Cloud Translation v3 `projects/<id>/locations/global:translateText`, through REST | service-account JSON in `GOOGLE_TRANSLATE_CREDENTIALS_JSON` (base64), `GOOGLE_CLOUD_PROJECT` | `zh-CN` / `en` | |
| `LibreTranslateProvider` | `POST <LIBRETRANSLATE_URL>/translate` | optional `LIBRETRANSLATE_API_KEY` | `zh` / `en` | Self-hosted container (optional compose profile `translate`). Text never leaves the server. |

The provider is chosen in `settings.translation.provider`; `none` disables translation everywhere.

**Per-user behavior** (`users.user_language`, `recipient_language`, `translation_enabled`; admin-managed):

- **Outbound.** If enabled and `user_language ≠ recipient_language`:
  1. Translate `user_language → recipient_language`.
  2. Store an `outbound_original` row.
  3. Put the translated text in `wire_body_enc`.
  4. Recompute segments, since translation changes the encoding and length.

  With `preview_before_send=true`, the composer calls `/messages/preview` and shows the translated text before the user confirms.
- **Inbound.** If enabled, translate the received text `auto → user_language` when the detected source ≠ `user_language`, and store an `inbound_display` row.
- **Display.** The thread shows the user-language text by default, with a toggle that reveals the original or wire text and the language badge.

**Rules:**

- The provider is called from the `translate` queue: timeout 8 s, 3 retries with backoff.
- If outbound translation fails, the message stays `held/translation_pending` and becomes `failed/translation_error` after 3 minutes. The user is told and may send it untranslated with an explicit click.
- If inbound translation fails, show the original with a "translation unavailable" note.
- Texts are never logged.
- Character usage is recorded per user in `message_translations.characters` for cost visibility.
- Language detection: use the provider's detection. If that is unavailable, apply a heuristic: over 30% CJK Unified Ideographs → `zh`, otherwise `en`.

## 16. Analytics

- **Roll-up:** `stats:rollup` (every 5 minutes) upserts `stats_daily` for today and yesterday from `messages`, grouped by `date_trunc('day', created_at at time zone settings.default_timezone)`, `user_id` and `sim_id`. Re-test messages (`is_retest=true`) are excluded.
- **Metrics:**
  - `sent` = count of out messages reaching `sent|delivered`
  - `delivered` = count of `delivered`
  - `failed` = count of `failed`
  - `received` = count of in messages
  - `blocked` = count of `blocked`
  - **delivery ratio** = `delivered / nullif(sent,0)`, labelled "reported delivered ÷ sent"
  - **avg delivery time** = `avg(delivered_at - sent_at)`
  - top failure reasons = `failure_name` counts
- Reference SQL (overview by day):
```sql
select day, sum(sent) sent, sum(delivered) delivered, sum(failed) failed, sum(received) received,
       round(sum(delivered)::numeric / nullif(sum(sent),0), 4) as delivery_ratio,
       sum(delivery_ms_sum) / nullif(sum(delivery_ms_count),0) / 1000.0 as avg_delivery_sec
from stats_daily where day between $1 and $2 group by day order by day;
```

- **Charts (Recharts):**
  - Admin overview: stacked bar (sent, delivered, failed), line (delivery ratio), area (received), donut (SIM health distribution), table (top failure reasons).
  - Per user and per SIM: the same, plus cap usage (holds by reason).
  - Portal usage page: bar chart of the user's own sent and received, plus usage gauges against limits.
- **Exports:** CSV through `GET /api/admin/analytics/export.csv`. Use streaming, and protect against CSV formula injection: prefix cells starting with `=,+,-,@` with `'`.

## 17. Alerts (email and Telegram)

| Alert | Trigger | Severity | Auto-resolve |
| --- | --- | --- | --- |
| `device_offline` | no heartbeat for `offline_after_seconds` (90 s) + 60 s grace | warning (critical after 15 min) | on the next heartbeat |
| `device_battery_low` | battery < `battery_low_percent` and not charging | warning | battery ≥ threshold + 5, or charging |
| `device_app_stopped` | `service_restarted` event over 3 times an hour, or `permission_missing` | warning | after 1 h without events |
| `sim_state_change` | health → `absent`, `locked`, `no_service` or `error` | warning | when health returns to `active` |
| `sim_suspected_suspended` | §14.3 | critical | after a successful re-test |
| `sim_failure_spike` | failure ratio over 30% over the last 20 sends | warning | ratio under 10% |
| `queue_backlog` | over 500 queued/held for one SIM, or the oldest queued message is over 6 h old | warning | when cleared |
| `kill_switch_changed` | on/off | critical / info | none |
| `subscription_expiring` | daily digest of subscriptions ending within 3 days | info | none |
| `backup_failed` / `backup_restore_test` | backup job result | critical / info | on the next success |
| `login_anomaly` | over 10 failed admin logins in 10 min, or an admin login from a new IP | warning | none |
| `translation_provider_error` | over 5 provider failures in 5 minutes | warning | on success |

**Delivery** (the `notify` queue):

- **Email:** `nodemailer` over SMTP (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`).
- **Telegram:** `POST https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/sendMessage` with `chat_id` from settings and plain text. Never include message bodies or full phone numbers; mask numbers.
- Each alert type can be toggled per channel in Settings.
- Dedupe key = `type:deviceId|simId`. A re-notification for an open critical alert goes out at most once every 60 minutes.

## 18. Security requirements (implementation tasks)

### 18.1 Passwords and 2FA

- `@node-rs/argon2` with argon2id, `memoryCost 19456 KiB`, `timeCost 2`, `parallelism 1` (OWASP minimum). Rehash on login if the parameters change.
- **TOTP for admins is mandatory.** Use `@oslojs/otp` (`verifyTOTPWithGracePeriod`: 30 s period, 6 digits, ±1 step), or `otplib`.
  - The secret is 20 random bytes, stored as `totp_secret_enc`.
  - Store `totp_last_used_step` to block replay.
  - 10 recovery codes, argon2id-hashed, each usable once.
- Optional TOTP for users (F-later; off by default).

### 18.2 Sessions
As in §11. Admin idle timeout 30 minutes, absolute 12 h. Re-authentication (password + TOTP) is required for:

- password resets of other users
- retire device
- kill switch
- reverse opt-out
- settings changes to security keys
- export of the audit log

This is a "sudo mode" lasting 10 minutes.

### 18.3 CSRF

- Cookies are `SameSite=Strict`.
- Every mutating request must:
  - carry an `Origin` header equal to the app's host
  - carry `X-CSRF-Token`, a double-submit token: a cookie `__Host-gcho_csrf` (not HttpOnly, random 32 bytes) whose value is echoed in the header
- Server Actions additionally rely on Next.js's built-in Origin check.
- Reject with 403 `csrf_failed`.

### 18.4 Field encryption

- `packages/core/src/crypto/field.ts`: AES-256-GCM with node `crypto`, a 96-bit random IV per value, and a 128-bit tag. AAD = `<table>.<column>.<rowId>`, which prevents swapping ciphertexts between rows.
- **Keys:**
  - `FIELD_ENCRYPTION_KEYS` = a JSON map `{ "k1": "<base64 32 bytes>", ... }`
  - `FIELD_ENCRYPTION_ACTIVE_KEY_ID` = `"k1"`
- Rotation: a new active key ID, plus a `pnpm db:reencrypt` script that rewrites rows in batches.
- **Blind index:** `PHONE_INDEX_KEY` (base64 32 bytes) gives `HMAC-SHA256` over E.164 for `*_hash` columns.
- **Encrypted columns:**
  - `users.totp_secret_enc`
  - `sims.phone_number_enc`
  - `conversations.peer_number_enc`, `last_preview_enc`
  - `messages.wire_body_enc`
  - `message_translations.*_enc`
  - `contacts.name_enc`, `number_enc`
  - `group_sends.body_template_enc`
  - provider secrets stored in settings, if any
- **Inbox search over encrypted bodies:**
  - Number search uses the blind index.
  - Text search decrypts the user's messages server-side, within the selected conversation or the last 90 days (max 5,000 messages), and filters in memory. Document this trade-off in code comments.

### 18.5 Device tokens

- Tokens are 32 random bytes (64 hex characters), stored as `HMAC-SHA256(TOKEN_PEPPER, token)`. Pairing codes use the same HMAC.
- Rotation and revocation as in §9.7. Rotation is automatic after 30 days.
- Compare in constant time, by indexed lookup on the hash.
- On the device, store tokens in EncryptedSharedPreferences.

### 18.6 HTTP security headers (Next.js `middleware.ts` + `next.config.ts` `headers()`)

- `Content-Security-Policy` with a per-request nonce:
  `default-src 'self'; script-src 'self' 'nonce-<n>' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'`
  (shadcn/Tailwind need `style-src 'unsafe-inline'` only for Radix inline styles.)
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Resource-Policy: same-origin`
- `X-Frame-Options: DENY`
- Remove `X-Powered-By` (`poweredByHeader: false`).
- Self-host fonts with `next/font/local`, so no third-party origins are needed.

### 18.7 Admin isolation

- The admin app is served only on `ADMIN_HOST`, and the reverse proxy restricts it to `ADMIN_IP_ALLOWLIST` (CIDRs).
- The admin middleware **also** enforces the allowlist:
  - Use the client IP from `X-Forwarded-For`, trusting only the proxy's address (`TRUSTED_PROXY_CIDRS`).
  - Return 404 (not 403) to non-allowlisted IPs, to avoid revealing the panel.
- Recommended: put the admin host behind WireGuard or Tailscale and allowlist the VPN subnet only.
- The admin panel is never linked from the portal. `robots.txt` on every host is `Disallow: /`, and pages carry `noindex` meta.

### 18.8 Input validation

- **Zod schemas for every route body, query and params, device payload, setting value and env var.**
  - Env is parsed by `packages/core/src/env.ts` at boot; the process fails fast on invalid config.
  - Body size limit is 64 KB, except CSV import at 1 MB.
- Phone numbers go through `libphonenumber-js` `parsePhoneNumberWithError` + `isValid()`.
- Output encoding: React escapes by default. **`dangerouslySetInnerHTML` is banned** through an ESLint rule.

### 18.9 Rate limiting
`rate-limiter-flexible` with Redis:

| Scope | Limit |
| --- | --- |
| Login per IP | 20/min |
| Login per username | 5 per 15 min, then lock |
| Portal API per user | 120/min |
| Admin API per admin | 300/min |
| Device API per device | 120/min |
| `register` per IP | 10/min |
| CSV import per user | 5/hour |

The reverse proxy adds a coarse per-IP limit.

### 18.10 Audit log

- `audit(action, target, before, after)` is called by every mutating core service.
- Redaction is applied automatically to the keys `password*`, `token*`, `*secret*`, `*_enc`, `body`.
- Hash chain per §6.15. The DB role `gchopro_app` has `INSERT, SELECT` on `audit_logs` only; migrations run as `gchopro_owner`.
- `GET /api/admin/audit/verify` checks the chain, and a weekly job alerts on a break.

### 18.11 Secrets and the repo

- No secrets in git. `.env.example` lists keys with empty values only.
- Add `gitleaks` to CI and as a pre-commit hook (lefthook).
- Production secrets live in `/etc/gchopro/*.env`, root-owned with mode 600, and are referenced by Compose `env_file`, or as Docker secrets.
- The release keystore for Android is never committed.

### 18.12 Errors and logging

- A generic error handler returns `{ error: code, message: safeText }`. No stack traces leave the server, and `NODE_ENV=production` is enforced.
- Logs use `pino` JSON with a redaction list (same keys as audit, plus `authorization`, `cookie`, `address`, `body`), and a request ID on every line (`x-request-id`).

### 18.13 Dependencies and supply chain

- `pnpm` with a lockfile.
- `pnpm audit --prod` in CI, failing on high or critical.
- Dependabot or Renovate.
- CodeQL workflow.
- Pin the Docker base images by digest. Containers run as a non-root user with a read-only root filesystem where possible.

### 18.14 Database and Redis

- Postgres and Redis listen only on the internal Docker network, with no published ports in production.
- Redis requires `requirepass` / ACL.
- Postgres uses a strong password, SCRAM-SHA-256 auth, and least-privilege roles.

### 18.15 Pentest checklist (run before launch; record results in `docs/security/pentest-checklist.md`)

- Authentication bypass and session fixation.
- Revocation timing: a reset password logs the user out within 5 s, and the old cookie is rejected.
- IDOR across users, conversations, SIMs and devices (e.g. access another user's conversation ID).
- Device token theft and replay, a mismatch between `:id` and the token, and use of a retired device.
- CSRF on every mutating route, and the CSP in place (no inline script executes).
- SQL injection (Drizzle parameterization, raw SQL review), XSS (message bodies with HTML or JS payloads), and CSV injection.
- Rate-limit bypass (headers spoofing `X-Forwarded-For`).
- Admin panel reachable from a non-allowlisted IP (must 404).
- Secrets in the APK (decompile and check), and secrets in the image layers.
- Backup files encrypted and not web-accessible.
- TLS configuration (SSL Labs grade A or better).

## 19. Compliance features

### 19.1 Opt-out handling

- **Inbound keyword detection** runs on every received message:
  1. Trim it and fold the case (NFKC).
  2. A match is when the **entire message** equals a keyword in `settings.opt_out_keywords`, or the message starts with a keyword followed by whitespace or punctuation. Defaults include STOP, UNSUBSCRIBE and 退订.
- **On a match:**
  1. Insert into `opt_outs` (scope `settings.opt_out_scope`, default `global`).
  2. Cancel any queued, held or scheduled messages to that number (`blocked/opted_out`).
  3. Optionally send **one** confirmation message, in Chinese or English based on the detected language. This is the only send allowed to an opted-out number, and it goes through the normal gates except opt-out.
  4. Flag the conversation in the portal with "Opted out".
  5. Write the audit log.
- **Opt-in keywords** (START, 订阅) reverse a keyword-sourced opt-out for that number, with an audit entry. Admin-sourced opt-outs are reversed only by an admin, with a reason.
- **Blocking:** gate 3 (§13.3) is enforced at enqueue and again at dispatch. The UI disables compose to opted-out numbers and shows why.

### 19.2 Consent on contacts

- `consent_source` is mandatory for every contact. CSV import rows without a valid source are rejected.
- Contacts on the opt-out list are imported but flagged and are unsendable.

### 19.3 Sender identification and content

- Optional automatic signature (§13.8).
- Blocked-keyword content rules set by the admin.
- Each portal user accepts the Acceptable Use terms at first login. Record `users.aup_accepted_at`.

### 19.4 Policy text
Shown in the portal footer and the admin help:

> "Messages may only be sent to recipients who have consented or have an existing relationship with the sender. Purchased or scraped lists are prohibited. Recipients can reply STOP or 退订 to opt out at any time. Operation must comply with local telecommunications regulations (for example the Pakistan Telecommunication Authority where applicable) and the terms of service of each carrier."

### 19.5 Privacy

- Retention purge (`retention:purge`) deletes or nulls `wire_body_enc` and translations older than `retention.message_body_days`, keeping the metadata needed for statistics.
- An admin "delete user data" action anonymizes a user's contacts and conversations.

## 20. Screens

**UI conventions (both apps):**

- Tailwind CSS v4 + shadcn/ui (Radix), `lucide-react` icons, TanStack Table for data tables, `react-hook-form` + `@hookform/resolvers/zod` for forms, `sonner` toasts.
- Light and dark mode (F19) through `next-themes`.
- Responsive at 320, 768, 1024 and 1440 px with no horizontal scroll, and touch targets of at least 44 px.
- Every screen has **loading** (skeleton), **empty** (illustrated text plus a primary action), **error** (safe message plus retry) and **forbidden** states.
- Dates are shown in the viewer's timezone. Phone numbers are formatted internationally and masked in lists unless the user expands them (admin).
- i18n (F18): `next-intl` with `en` and `zh-CN` message catalogs, with an interface language switch on the login page and in settings.

### 20.1 Admin panel (`apps/admin`)

| # | Screen | Route | Components | Key states / behaviour |
| --- | --- | --- | --- | --- |
| A1 | Login | `/login` | username, password, submit | locked-account message; generic "invalid credentials" |
| A2 | 2FA enroll / verify | `/login/2fa` | QR code, manual secret, 6-digit input, recovery-code input, recovery codes display (once) | enrollment forced on first login |
| A3 | Dashboard | `/` | KPI cards (devices online/offline, SIMs by health, users active, capacity free, queue queued/held, open alerts), **Kill switch** toggle with confirm and reason, recent alerts list, 24 h traffic mini-chart | live updates through SSE; red banner when the kill switch is on |
| A4 | Devices | `/devices` | table (name, status, online dot, battery, charging, network, app version, model, SIMs n/slots), "Pair device" button | Pair dialog shows the 6-digit code, a countdown, the gateway URL, and a "waiting for device…" live state that turns to success |
| A5 | Device detail | `/devices/[id]` | info card, SIM cards per slot, event timeline, actions (rename, pause, rotate token, retire with typed confirm) | offline warning; retired read-only |
| A6 | SIMs / health | `/sims` | filter by health/device/assigned; table (device, slot, carrier, number, health badge, signal bars, service state, consecutive failures, last OK send, assigned user, usage today) | health badge colors: active green, no_service amber, absent/locked grey, suspected_suspended red, paused_admin blue, inactive muted |
| A7 | SIM detail | `/sims/[id]` | health history timeline (`sim_events`), failure-reason chart, 7-day stats, number edit, policy override, Pause/Resume, **Re-test** dialog (test number select, carrier guidance text) | re-test progress live; result toast |
| A8 | Capacity | `/capacity` | per-device bars (slots, active SIMs, assigned, free), totals, "users without SIM" list | |
| A9 | Users | `/users` | search, filters (status, subscription), table (username, display name, SIM number, subscription status/ends, language pair, last login, sessions) | |
| A10 | Create / edit user | `/users/new`, `/users/[id]/edit` | form: username, display name, password (generate/show once), SIM picker (only free active SIMs), policy select, languages (user/recipient) + translation toggle, timezone, export/self-password toggles, IP allowlist, initial subscription (unit, quantity, start) | shows the initial password once, with a copy button |
| A11 | User detail | `/users/[id]` | profile, SIM card, subscription card (extend/pause/resume/disable/enable), payments list + "Record payment", usage gauges, active sessions (revoke), actions: reset password (sudo), disable/enable, assign/unassign SIM, read-only support view link (if enabled) | every destructive action has a confirm dialog |
| A12 | Subscriptions | `/subscriptions` | tabs: active, expiring (≤ 3 days), expired, disabled; bulk extend | |
| A13 | Payments | `/payments` | table, filters, record payment, void with reason, CSV export | |
| A14 | Policies | `/policies` | list, create/edit form (gap, jitter, caps, segments/day, group max, window, days, timezone mode, over-limit action), "effective rate" helper text and warnings | the default policy cannot be deleted |
| A15 | Opt-outs | `/opt-outs` | table (masked number, scope, source, keyword, date), add, reverse (sudo plus reason) | |
| A16 | Templates | `/templates` | shared templates and quick replies CRUD, variable helper, segment counter | |
| A17 | Analytics | `/analytics` | date range, granularity, overview charts, leaderboard, per-user and per-SIM drill-down, export CSV | |
| A18 | Alerts | `/alerts` | open/acknowledged/resolved tabs, ack button, detail drawer | |
| A19 | Audit log | `/audit` | filterable table, JSON diff drawer (redacted), "Verify chain" button, export (sudo) | |
| A20 | Notices | `/notices` | create notice (audience, schedule), list | |
| A21 | Settings | `/settings` | sections: Kill switch, Translation provider (keys are "configured/not configured" only; test button), Alerts (email recipients, Telegram chat ID, test send), Health thresholds, Opt-out keywords and confirmation texts, Sender signature, Content rules, Retention, Defaults (timezone, region, default policy), Support view toggle, Test numbers | each section saves separately; sudo for security sections |
| A22 | Support view (read-only) | `/users/[id]/support` | the portal inbox rendered read-only, with a "Support view: audit-logged" banner | only if enabled |
| A23 | System health | `/system` | DB, Redis and worker heartbeat; queue sizes per SIM; last backup and restore test | |

### 20.2 User portal (`apps/portal`)

| # | Screen | Route | Components | Key states / behaviour |
| --- | --- | --- | --- | --- |
| P1 | Login | `/login` | username, password, language switch | messages for `?reason=password_reset`, `subscription_inactive`, `user_disabled`, `sim_unassigned`, `expired`: "Your session ended because …" |
| P2 | Change password (forced) | `/password` | current, new, confirm, strength meter | forced when `must_change_password` |
| P3 | Acceptable use | `/welcome` | AUP text (§19.4), accept button | first login only |
| P4 | Inbox | `/` (list) + `/c/[id]` (thread) | left: conversation list (search, filters unread/failed/archived/tag, unread badges); right: thread (bubbles out right / in left, status chips Queued/Held(reason)/Sending/Sent/Delivered/Failed(reason)/Blocked(reason), translation toggle per bubble "Original / Translated", date separators); composer pinned bottom: textarea, segment & encoding counter, translation preview panel, template/quick-reply picker, schedule button, send | Line unavailable banner (SIM unhealthy); Read-only banner (expired read-only); Opted-out banner on that conversation; offline reconnect indicator for SSE; sound + browser notification on new inbound (F6), user-toggleable |
| P5 | New message / group | `/new` | recipients input (numbers, contacts, groups; chips with validation and opt-out flags), body, template, preview, schedule | shows blocked recipients before confirm; cap warning |
| P6 | Group send progress | `/groups/sends/[id]` | progress bar by status, per-recipient table, cancel remaining | |
| P7 | Contacts | `/contacts` | table, add/edit (consent source required), CSV import wizard (upload → map columns → validate → result), tags | |
| P8 | Groups | `/groups` | CRUD, member picker | |
| P9 | Templates & quick replies | `/templates` | own CRUD; shared read-only | |
| P10 | Scheduled | `/scheduled` | list with cancel | |
| P11 | Usage & subscription | `/usage` | gauges: per-minute/hour/day and segments vs limits (F4); subscription status, end date, days left; sending window; usage chart | expiry reminder banner ≤ 3 days (F5) |
| P12 | Notices | `/notices` | list; unread dot in header | |
| P13 | Settings | `/settings` | change password (if allowed), notification and sound toggles, interface language, theme, export conversations (if allowed) | |
| P14 | Subscription inactive | `/inactive` | explanation and "contact your administrator" | shown when blocked |

The portal is a PWA (F19): `manifest.webmanifest` and a service worker, with Web Push optional (`web-push`, VAPID keys) for new-message notifications when the tab is closed. Default: in-tab notifications only (§26).

## 21. Tech stack and repository structure

### 21.1 Exact stack

| Concern | Choice |
| --- | --- |
| Language | TypeScript 5.x, `strict: true`, `noUncheckedIndexedAccess: true` |
| Runtime | Node.js 22 LTS |
| Package manager / monorepo | pnpm workspaces + Turborepo |
| Web apps | Next.js 15 App Router (or the current stable), React 19, `output: "standalone"` |
| UI | Tailwind CSS v4, shadcn/ui, Radix, lucide-react, next-themes, sonner, TanStack Table, react-hook-form, `@hookform/resolvers` |
| Charts | Recharts |
| i18n | next-intl |
| DB | PostgreSQL 16, Drizzle ORM + drizzle-kit, `postgres` (porsager) driver |
| Queue / cache | Redis 7, BullMQ 5, ioredis |
| Validation | Zod 3 |
| Auth | Custom sessions (Lucia-guide pattern), `@oslojs/crypto`, `@oslojs/encoding`, `@oslojs/otp`, `@node-rs/argon2`, `qrcode` |
| Rate limiting | rate-limiter-flexible |
| Phone numbers | libphonenumber-js (max metadata) |
| Dates | date-fns + date-fns-tz |
| IDs | uuidv7 |
| Email | nodemailer |
| Logging | pino (+ pino-pretty in dev) |
| Real-time | Server-Sent Events from route handlers, backed by Redis pub/sub |
| Testing | Vitest (unit/integration), `@testcontainers/postgresql` + `@testcontainers/redis` (or the Compose test profile), Playwright (e2e), MSW for provider mocks |
| Lint / format | ESLint (typescript-eslint, eslint-plugin-security, react-hooks, a rule banning `dangerouslySetInnerHTML`), Prettier |
| Git hooks | lefthook (lint-staged, gitleaks) |
| Containers | Docker, Docker Compose v2 |
| Reverse proxy | Caddy 2 (automatic TLS) |
| Android | Kotlin, AGP 8.x, androidx.work, androidx.security:security-crypto, JUnit 5/Robolectric |

### 21.2 Repository layout
```
gchopro/
├─ apps/
│  ├─ admin/                 # Next.js admin panel (ADMIN_HOST)
│  │  ├─ app/(auth)/login, app/(auth)/login/2fa
│  │  ├─ app/(panel)/...     # screens A3–A23
│  │  ├─ app/api/admin/...   # §10.1
│  │  └─ middleware.ts       # IP allowlist, host check, session+MFA, CSP nonce, CSRF
│  ├─ portal/                # Next.js user portal (PORTAL_HOST) + device API (GATEWAY_HOST)
│  │  ├─ app/(auth)/..., app/(app)/...   # screens P1–P14
│  │  ├─ app/api/portal/...  # §10.2
│  │  ├─ app/api/devices/... # §9 (device protocol v2)
│  │  └─ middleware.ts       # host routing: GATEWAY_HOST → only /api/devices/*, session, CSP, CSRF
│  └─ worker/                # Node service: BullMQ workers + schedulers
│     └─ src/{index.ts, supervisor.ts, processors/send.ts, processors/translate.ts, processors/notify.ts, jobs/*.ts}
├─ packages/
│  ├─ db/                    # Drizzle schema (§6), migrations, seed, db client, roles SQL
│  ├─ core/                  # domain services used by all apps
│  │  └─ src/{env.ts, auth/, sessions/, crypto/, audit/, users/, devices/, sims/, health/, messaging/, sms/segments.ts, ratelimit/, queue/, translation/, compliance/, subscriptions/, analytics/, alerts/, realtime/, settings/}
│  ├─ ui/                    # shared shadcn components, theme, charts wrappers
│  └─ config/                # eslint, tsconfig, tailwind presets
├─ android/                  # GChoPro Android gateway app (fork of sim-desk android/, §7)
├─ infra/
│  ├─ docker-compose.yml     # dev: postgres, redis, mailpit, (libretranslate profile)
│  ├─ docker-compose.prod.yml
│  ├─ Caddyfile
│  ├─ backup/ (backup.sh, restore-test.sh)
│  └─ postgres/init-roles.sql
├─ docs/ (ARCHITECTURE.md, RUNBOOK.md, SECURITY.md, security/pentest-checklist.md, ANDROID-SETUP.md)
├─ e2e/                      # Playwright tests
├─ .env.example
├─ PROGRESS.md
└─ turbo.json, pnpm-workspace.yaml, package.json
```

**Rule:** business logic lives in `packages/core`. Route handlers and server actions are thin: parse with Zod, call core, map the result. The worker imports the same core.

## 22. Testing requirements and acceptance criteria

### 22.1 Test requirements

- **Unit tests (Vitest)** for:
  - `segments.ts`
  - `classify.ts`
  - the health state machine
  - the subscription state machine and date math (DST and month-end cases)
  - field crypto (round-trip, AAD mismatch fails, key rotation)
  - the blind index
  - the cap Lua script (through a Redis container)
  - gate ordering
  - opt-out keyword matching (EN and ZH)
  - template rendering
  - CSV injection escaping
  - env parsing
- **Integration tests** (Vitest + Postgres/Redis containers): every route in §9 and §10 for the happy path and its main error codes, including authorization (wrong role, other user's resource → 404).
- **Worker tests:**
  - with fake timers, prove that two messages on one SIM dispatch ≥ `base - jitter` seconds apart
  - caps hold, then release
  - the window holds until opening
  - the kill switch stops dispatch within 2 s
  - retries stay on the same SIM queue
  - suspended SIMs are never drained to another SIM
- **E2E (Playwright)** against the Compose stack with a **fake device simulator** (`e2e/device-sim.ts`) that implements protocol v2 (register, heartbeat, SIM report with 2 SIMs, pending, report, inbox). The flows:
  1. admin login + TOTP
  2. pair the simulated device
  3. create a user bound to SIM 1
  4. user login
  5. send a message
  6. the device sim reports sent and delivered
  7. inbound reply appears live
  8. the admin resets the password and the user's tab is redirected to login within 5 s
  9. a STOP reply blocks the next send
  10. a suspension-signal failure flips the SIM to suspected_suspended, shows the banner, raises an alert, and a re-test restores it
  11. translation with a mocked provider shows both texts
  12. subscription expiry blocks login
- **Android:** the JUnit tests in §7.6, plus a manual on-device checklist in `docs/ANDROID-SETUP.md`: dual-SIM send per slot, inbound tagging per slot, airplane mode → `no_service`, SIM removal → `inactive`/`absent`, reboot → auto-start.
- **CI (GitHub Actions or equivalent):** install → lint → typecheck → unit → integration → build → e2e (Compose) → gitleaks → pnpm audit → Android `./gradlew test assembleDebug`.
- **Coverage:** at least 80% lines for `packages/core`.

### 22.2 Acceptance criteria (checklists)

**Devices and multi-SIM**

- [ ] The admin generates a pairing code. The simulated device registers with protocol v2. A protocol v1 register gets 426.
- [ ] A SIM report with 2 SIMs creates 2 `sims` rows. Re-reporting with a changed `subscriptionId` but the same slot, carrier and number reconciles to the same row.
- [ ] Removing a SIM from the report marks it `inactive` and shows "line unavailable" to its user.
- [ ] The capacity page shows slots, active, assigned and free correctly. User creation only offers free active SIMs.
- [ ] Inbound messages with `subscriptionId` are routed to the user who owns that SIM. Unknown subscriptions go to the unroutable list and raise an alert.
- [ ] Inbox dedupe is per `(device_id, provider_id)`. Two devices with the same `_ID` do not collide.
- [ ] Token rotation works, with a 10-minute grace period for the old token. A retired device gets 401 `device_revoked`.

**Users, sessions, subscriptions**

- [ ] The admin creates a user with a generated password, shown once. The first login forces a password change and AUP acceptance.
- [ ] An admin password reset revokes all of the user's sessions. An open portal tab redirects to login within 5 s, the old cookie returns 401, and the old password fails.
- [ ] Disabling a user or subscription, an expiry, or unassigning a SIM each revoke sessions with the correct reason message.
- [ ] Subscriptions by day, week, month and year compute `ends_at` correctly in the user's timezone. Pause and resume preserve the remaining time. Extend works from active and expired.
- [ ] The expiry reminder appears 3 days before (once). Expired users with `read_only` can log in but cannot send.
- [ ] Payments can be recorded and voided, and both are audit-logged.

**Messaging and pacing**

- [ ] A one-to-one send creates the conversation and message, the paced dispatch, the device report, and status updates live in the thread.
- [ ] A group send of N recipients creates N messages on the same SIM queue. Opted-out recipients are reported as blocked, and the cap on recipients is enforced.
- [ ] Consecutive dispatches on one SIM are separated by `base ± jitter` (never below the floor). Two SIMs dispatch independently.
- [ ] Per-minute, per-hour and per-day caps and segments per day hold messages (or reject, per policy). Usage gauges reflect the counters.
- [ ] Messages queued outside the send window are held until it opens.
- [ ] The kill switch (global, device, SIM) stops new dispatches within 2 s, and resuming continues in order.
- [ ] Transient failures retry at most twice on the **same SIM**. Suspension-signal and permanent failures never retry. No code path moves messages between SIMs.
- [ ] The segment counter matches the reference vectors for GSM-7, extension characters, UCS-2 and emoji.
- [ ] A scheduled send dispatches at or after the scheduled time, subject to every gate.
- [ ] Templates with variables render. Missing variables give 422.

**SIM health and alerts**

- [ ] Failure names are classified per §14.2.
- [ ] 2 suspension signals in 24 h, or 3 consecutive failures in service, give `suspected_suspended`: the SIM queue is paused, the portal banner is shown, a critical alert is created, and an email and Telegram message are sent (mocked in tests).
- [ ] Resuming from `suspected_suspended` is only possible through a successful re-test. A failed re-test keeps the state.
- [ ] Device offline and battery-low alerts fire and auto-resolve. Dedupe prevents duplicates.

**Translation**

- [ ] With zh→en enabled, a Chinese outbound message is sent in English (wire), stores the original, and the thread shows both through the toggle.
- [ ] An English inbound message is shown in Chinese, with the original available.
- [ ] A provider failure holds the outbound message, and after the timeout the user can send it untranslated explicitly.
- [ ] The provider can be switched in Settings (DeepL, Google, LibreTranslate, none), with a test button.

**Analytics**

- [ ] Per-user and per-SIM charts show sent, received, delivered, failed, delivery ratio and average delivery time for the chosen range.
- [ ] Re-test messages are excluded. CSV export is escaped against formula injection.

**Security**

- [ ] Admin access requires the allowlisted IP (others get 404), the correct host, and TOTP. Sudo mode is enforced for sensitive actions.
- [ ] Passwords are stored as argon2id. Lockout applies after 5 failures.
- [ ] CSRF is rejected without the header or with a cross-origin `Origin`. The CSP header is present with a nonce, and no inline script runs.
- [ ] Encrypted columns contain no plaintext (an integration test reads the raw DB). The blind index lookup works.
- [ ] The audit log records every admin mutation, redaction is applied, and chain verification passes (and fails after tampering).
- [ ] gitleaks is clean. `.env.example` has no values. Production containers run as non-root, and Postgres and Redis are not exposed.

**Compliance**

- [ ] STOP, 退订 and the other keywords create an opt-out, cancel pending messages to that number, optionally send one confirmation, and block future sends. START or 订阅 reverses keyword opt-outs.
- [ ] Contacts require a consent source. CSV import rejects rows without one and flags opted-out numbers.
- [ ] The signature is appended when enabled and counted in segments.

## 23. Environment variables and seed data

### 23.1 `.env.example` (all values empty in the repo)
```
# Core
NODE_ENV=
APP_ENV=                      # development | staging | production
DATABASE_URL=                 # postgres://gchopro_app:...@postgres:5432/gchopro
DATABASE_OWNER_URL=           # for migrations only
REDIS_URL=                    # redis://:password@redis:6379/0
ADMIN_HOST=                   # admin.example.com
PORTAL_HOST=                  # app.example.com
GATEWAY_HOST=                 # gw.example.com
PUBLIC_PORTAL_URL=            # https://app.example.com
PUBLIC_GATEWAY_URL=           # https://gw.example.com (shown in the pairing dialog)
TRUSTED_PROXY_CIDRS=          # e.g. 172.16.0.0/12
ADMIN_IP_ALLOWLIST=           # comma-separated CIDRs
# Crypto
FIELD_ENCRYPTION_KEYS=        # {"k1":"<base64 32 bytes>"}
FIELD_ENCRYPTION_ACTIVE_KEY_ID=
PHONE_INDEX_KEY=              # base64 32 bytes
TOKEN_PEPPER=                 # base64 32 bytes
SESSION_SECRET=               # base64 32 bytes (CSRF token HMAC)
DEVICE_TOKEN_MAX_AGE_DAYS=30
# Seed
SEED_ADMIN_USERNAME=
SEED_ADMIN_PASSWORD=          # used once by pnpm db:seed; must be changed at first login
ADMIN_TEST_NUMBERS=           # comma-separated E.164 numbers allowed for SIM re-tests
# Translation
DEEPL_API_KEY=
DEEPL_API_URL=                # https://api-free.deepl.com or https://api.deepl.com
GOOGLE_CLOUD_PROJECT=
GOOGLE_TRANSLATE_CREDENTIALS_JSON=   # base64 of the service-account JSON
LIBRETRANSLATE_URL=
LIBRETRANSLATE_API_KEY=
# Alerts
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
TELEGRAM_BOT_TOKEN=
# Web push (optional)
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=
# Backups
BACKUP_ENABLED=
BACKUP_AGE_RECIPIENT=         # age public key; the private key is kept offline
BACKUP_RCLONE_REMOTE=         # e.g. s3remote:gchopro-backups
BACKUP_RETENTION_DAYS=30
# Logging
LOG_LEVEL=info
```
`packages/core/src/env.ts` validates all of these with Zod (base64 length checks, CIDR parsing, URL formats). Missing required values abort startup with a clear message that names the key, never its value.

A `pnpm gen:secrets` script prints freshly generated values for the crypto keys, to paste into the server env file.

### 23.2 Seed (`pnpm db:seed`, idempotent)

- **Admin user** from `SEED_ADMIN_*`, with `must_change_password=true` and TOTP enrollment required.
- **Rate-limit policies:**
  - `Conservative (default)`: 15 s ± 5 s, 3/min, 50/h, 300/day, 400 segments/day, group max 50, 09:00–20:00 every day, user timezone, hold.
  - `Very conservative`: 30 s ± 10 s, 2/min, 30/h, 150/day.
  - `Custom (template)`: a copy of the default.
- **Settings** keys with the defaults from §6.20.
- **Shared templates:** "Greeting" (`Hello {name}, …`) and the quick replies "Thanks, noted." and "收到，谢谢。".
- **Dev only (`APP_ENV=development`):**
  - a fake device `Dev Phone` with 2 SIMs (`subscriptionId` 1 and 2) and a known dev token printed to the console
  - users `demo1` (SIM 1, zh→en translation, active monthly subscription) and `demo2` (SIM 2, en only, subscription expiring in 2 days)
  - sample conversations
  - one opt-out (`+15005550006`)

  Never run this in production; the seed refuses when `APP_ENV=production`.

## 24. Milestone build order

Every milestone ends with: lint + typecheck + tests green, `PROGRESS.md` updated, and one commit (or a small series) tagged `m<N>`.

| Milestone | Scope | Definition of done |
| --- | --- | --- |
| **M0: Foundation** | pnpm + Turborepo monorepo; `apps/admin`, `apps/portal`, `apps/worker`, `packages/{db,core,ui,config}`; TS strict; ESLint/Prettier; lefthook + gitleaks; `infra/docker-compose.yml` (postgres, redis, mailpit); `env.ts` with Zod; Drizzle setup with the **full schema from §6** and the first migration; DB roles SQL; pino logging; CI pipeline; `.env.example`; `PROGRESS.md`; `docs/ARCHITECTURE.md` stub | `pnpm i && pnpm dev` starts all three apps against Compose; `pnpm db:migrate` and `pnpm db:seed` work; CI is green; no secrets in git |
| **M1: Security and auth baseline** | field crypto + blind index; argon2id; sessions (§11); admin login + TOTP enroll/verify + recovery codes + sudo mode; portal login/logout/forced password change/AUP; CSRF; CSP and security headers; admin IP allowlist + host checks; rate limiting; audit service + hash chain; `revokeAllSessions` + SSE `session.revoked`; settings service | unit and integration tests for all of these; e2e: admin login with TOTP, portal login, forced change; revocation e2e (manual trigger) under 5 s |
| **M2: Devices and multi-SIM** | device protocol v2 routes (§9) in `apps/portal` with GATEWAY_HOST routing; pairing from admin; SIM reconciliation; heartbeat/events; token rotation/revocation; **Android app changes (§7)**; admin screens A4–A8; device simulator for tests | the simulator pairs, reports 2 SIMs and heartbeats; the Android app builds (`assembleDebug` + unit tests) and on a real dual-SIM phone reports both SIMs (manual checklist); capacity is correct |
| **M3: Users and subscriptions** | user CRUD, SIM assignment, password reset with revocation, disable/enable; subscription state machine + `subscriptions:tick`; payments log; notices; screens A9–A13, A20, P1–P3, P11 (subscription part), P12, P14 | acceptance checklist "Users, sessions, subscriptions" passes |
| **M4: Messaging core and paced queue** | conversations/messages services; portal send, preview, cancel; segments; BullMQ supervisor + per-SIM queues + gates (§13.3) + leases + retries (same SIM) + kill switch; device pending/report/inbox wired into messages; inbound routing; SSE live updates; group sends; templates and quick replies; scheduled sends; contacts/groups + CSV import with consent; screens A3 (full), A14, A16, P4–P10, P13 | acceptance checklist "Messaging and pacing" passes, including the fake-timer pacing tests and the e2e send/receive |
| **M5: SIM health, alerts, compliance** | classifier + health state machine + `sim_events`; auto-pause on suspected suspension; re-test flow; alerts service + email/Telegram + dedupe; opt-out keywords, confirmation, opt-in, blocking; signature; content rules; screens A6/A7 (health), A15, A18, A21 (alerts, health, compliance sections) | acceptance checklists "SIM health and alerts" and "Compliance" pass |
| **M6: Translation** | provider interface + DeepL/Google/LibreTranslate adapters; translate queue; outbound/inbound flows; preview; per-user language settings in admin; thread toggle; provider test button; optional LibreTranslate compose profile | acceptance checklist "Translation" passes with mocked providers; one live smoke test per configured provider (manual) |
| **M7: Analytics and remaining features** | `stats_daily` rollup; admin analytics screens + exports; portal usage charts + gauges; inbox search/filters/tags/archive; conversation export; notifications (sound/browser, optional web push); i18n en/zh-CN; dark mode; PWA manifest; read-only support view (behind a setting); system health page A23 | acceptance checklist "Analytics" passes; Lighthouse PWA installable; i18n covers every screen |
| **M8: Hardening, deployment, docs** | `docker-compose.prod.yml` + Caddyfile (§25); backups + restore test job; retention purge; pentest checklist executed and fixed; full e2e suite; `docs/RUNBOOK.md` (install, pair a phone, rotate keys, restore a backup, incident: suspected suspension), `docs/ANDROID-SETUP.md` (permissions, battery optimisation, Android SMS limiter note, restricted settings), `docs/SECURITY.md`; signed release APK build instructions | a fresh server goes from zero to running by following RUNBOOK only; SSL Labs A; the restore test succeeds; every acceptance checklist is ticked in `PROGRESS.md` |

**Out of scope unless enabled in §26:** F20 (user API keys and webhooks) and F21 (white-label). If enabled, they become M9.

## 25. Deployment

- **Target:** any Linux server (Ubuntu 24.04 LTS recommended), with at least 2 vCPU, 4 GB RAM and 40 GB SSD, running Docker Engine and Compose v2.
- **`infra/docker-compose.prod.yml` services:**
  - `caddy` (ports 80/443 only)
  - `admin`, `portal`, `worker` (built from the multi-stage Dockerfiles; Next.js `standalone`; user `node`; `read_only: true` with a tmpfs `/tmp`)
  - `postgres:16` (volume `pgdata`, no published port)
  - `redis:7` (`--requirepass`, `appendonly yes`, no published port)
  - optional `libretranslate` (profile `translate`)
  - all on the internal network `gcho`
- **`infra/Caddyfile`:**
  - `{$PORTAL_HOST}` → `portal:3000`
  - `{$GATEWAY_HOST}` → `portal:3000`, **only** the `/api/devices/*` path matcher; everything else gets 404
  - `{$ADMIN_HOST}` → `admin:3001`, with a `@allowed remote_ip {$ADMIN_IP_ALLOWLIST}` matcher; everything else gets 404
  - Automatic HTTPS, HSTS, `encode zstd gzip`, request size limits, and a coarse `rate_limit` (caddy-ratelimit plugin) or rely on app-level limits.
- **Host hardening (documented in RUNBOOK):**
  - SSH keys only, no root login
  - `ufw` allowing 22 (restricted), 80 and 443
  - `unattended-upgrades`
  - `fail2ban`
  - Docker log rotation
  - time sync
  - Secrets in `/etc/gchopro/gchopro.env` (mode 600) referenced by `env_file`.
- **Migrations:** a one-shot `migrate` service (`pnpm db:migrate`, using `DATABASE_OWNER_URL`) runs before the apps start.
- **Backups (`infra/backup/backup.sh`, run by the worker's `backup:run`, or by host cron if preferred):**
  1. `pg_dump -Fc`, encrypted with `age -r $BACKUP_AGE_RECIPIENT`, uploaded with `rclone` to `$BACKUP_RCLONE_REMOTE`.
  2. Local copies are pruned after 7 days, remote copies after `BACKUP_RETENTION_DAYS`.
  3. Redis is not backed up, because it is rebuildable. `queued` jobs are re-enqueued from the DB on worker start by `QueueSupervisor.reconcile()`.
  - The weekly `restore-test.sh` restores the latest backup into a temporary Postgres container, runs integrity queries, and reports through an alert.
- **Zero-downtime updates:** `docker compose pull && docker compose up -d` per service. The worker drains gracefully on SIGTERM (it finishes the current dispatch wait, up to 130 s).
- **Monitoring:** `/api/admin/health`, a worker heartbeat key in Redis, Docker healthchecks on every service, and an optional external uptime ping on the portal `/healthz`, which returns only `ok`.

## 26. Open questions (with the defaults to build against)

| # | Question | Default used for the build |
| --- | --- | --- |
| 1 | Expected scale at launch | Up to 30 devices, 60 SIMs, 60 users, 20,000 messages a day. Design must not preclude 10x. |
| 2 | Can admins read user message content? | **No by default.** The read-only support view exists behind `settings.portal.allow_admin_support_view=false`. When enabled, every access is audit-logged. |
| 3 | What "inbound control" does the admin need? | Per-SIM toggle `sims.inbound_enabled` (default true; when false, inbound rows from that SIM are stored but hidden from the user and flagged for the admin) and the inbox sync interval through the heartbeat response. Hiding or archiving inbound for a user is done through conversation archive. |
| 4 | Behaviour on expiry | `block` (login denied, sessions revoked). `read_only` is selectable per subscription. |
| 5 | Translation provider | Default `none`. When enabled, recommend **LibreTranslate (self-hosted)** for confidentiality, or **DeepL** for quality. Preview before send: on. |
| 6 | Default send limits | The `Conservative (default)` policy in §23.2. The minimum gap floor is 5 s. |
| 7 | Recipient countries | Any country `libphonenumber-js` validates. The send window uses the user's timezone. |
| 8 | Online payments | Not built. Manual `payments_log` only. |
| 9 | Multiple admin roles | Single `admin` role. All admins are equal. Every action is audited. |
| 10 | Opt-out scope | `global` (a number that opted out from any user is blocked for all users). |
| 11 | Web push when the tab is closed | Off (in-tab notifications only). VAPID support is built but disabled. |
| 12 | Certificate pinning in the Android app | Off by default (build flag). |
| 13 | User API keys and webhooks (F20) | **Not built** in M0–M8. |
| 14 | White-label (F21) | **Not built.** Branding lives in `settings.branding.product_name` only. |
| 15 | User 2FA | Optional for users; off by default. Mandatory for admins. |
| 16 | Default timezone and region | `Asia/Karachi` and `PK`. Editable in Settings. |
| 17 | Message body retention | 180 days, then the bodies are purged (metadata kept). |

Any other ambiguity: choose the safer and simpler option, note it in `PROGRESS.md` under "Decisions", and continue.

## 27. Known limitations

- **Android background limits.** OEM battery managers can kill the gateway. This is mitigated by a foreground service, a battery-optimisation exemption, auto-start, and an "app stopped" alert. Phones should stay on chargers and Wi-Fi.
- **Android's own SMS limiter.** The platform's `SmsUsageMonitor` caps app-sent SMS, by default around 30 per 30 minutes, and prompts the user above that. This is a per-phone throughput ceiling. The setup guide documents it, and the default policy stays within it (≈ 50/h per SIM, shared by the device's SIMs). Adjusting it per device is a manual device-setup decision recorded in `devices.sms_rate_limit_note`.
- **Carrier limits.** Daily and hourly caps and content filtering vary by carrier and are often unpublished. Pacing lowers the risk of restrictions but cannot rule it out. The platform responds by detecting, pausing and alerting, never by evading.
- **Multi-SIM hardware:**
  - Most phones keep two SIMs active at once (DSDS). A "3-SIM" setup is usually 2 physical SIMs plus an eSIM, with only two active.
  - Only one SIM carries mobile data, so use Wi-Fi.
  - A call on one SIM can interrupt the other.
  - `subscriptionId` can change when SIMs are swapped; this is handled by reconciliation.
  - The SIM phone number is often unreadable; the admin enters it.
- **Delivery reports** depend on the carrier and can be missing or late. The delivery ratio is "reported delivered ÷ sent".
- **Restricted SMS permissions:**
  - The app cannot be on Google Play.
  - Android 15+ needs "Allow restricted settings" before SMS permissions can be granted.
  - `READ_SMS` is needed for inbox sync.
- **Translation** quality varies. Cloud providers process the text. UCS-2 Chinese uses 70-character segments, so costs and caps are counted in segments.
- **Polling.** The device polls every 3 to 10 s. Push wake-up (e.g. FCM) is a possible later improvement, not part of this build.
- **Encrypted bodies** limit full-text search to server-side decrypt-and-filter within bounded ranges.
- **A single server** is a single point of failure. Encrypted off-site backups and a tested restore define the recovery path. High availability is out of scope.
