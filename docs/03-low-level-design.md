# 03 — Low-Level Design

This is the implementation reference. Every API, schema, signature, and state
machine the driver-app effort needs is documented here. Read top-to-bottom
before starting `05-tasks-antigravity.md`.

---

## 1. DynamoDB schema additions

We extend the existing `ReyyEV` table. No new tables.

### 1.1 Customer profile — new attribute

Existing item: `PK = CUSTOMER#<cid>`, `SK = PROFILE`.

| New attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `driverPasswordHash` | S | optional | bcrypt hash, cost factor 10. Absent until admin sets a password. |

No GSI changes.

### 1.2 Phone uniqueness / login lookup row

New item type. One per customer who has a login.

| Attribute | Value | Notes |
| --- | --- | --- |
| `PK` | `PHONE#<digits>` | Normalised phone, digits only, with country code. e.g. `PHONE#919876543210`. |
| `SK` | `UNIQUE` | Marker. |
| `customerId` | the customer UUID | Reverse lookup. |
| `createdAt` | ISO 8601 | Audit. |

Written transactionally with the customer profile update when an admin sets
the driver password (see §3.4).

### 1.3 Live location row

New item type. **Exactly one per active rental.** Overwritten every push.

| Attribute | Value | Notes |
| --- | --- | --- |
| `PK` | `CUSTOMER#<cid>` | Lives under the customer, so `Query(PK = CUSTOMER#<cid>)` returns it alongside everything else. |
| `SK` | `LOCATION#<rentalId>#LATEST` | One row per rental. |
| `GSI1PK` | `LOCATIONS` | All live positions across the fleet. |
| `GSI1SK` | `<isoTs>` | When this position was captured (sortable by recency). |
| `rentalId` | rental UUID | |
| `customerId` | customer UUID | |
| `lat` | N | Float, validated server-side `-90 ≤ lat ≤ 90`. |
| `lng` | N | Float, validated server-side `-180 ≤ lng ≤ 180`. |
| `accuracy` | N (optional) | Metres. |
| `batteryLevel` | N (optional) | 0–100. |
| `capturedAt` | S | ISO 8601, when the GPS was sampled on the device. |
| `receivedAt` | S | ISO 8601, when the server got the request. |

**Lifecycle:**
- **Created/updated:** by `POST /api/driver/location`.
- **Deleted:** when the rental closes (existing rental-close path adds a
  best-effort `DeleteCommand` for this SK; not transactional — the row
  becomes orphaned but harmless if delete fails, since the dashboard filters
  by active rental).

---

## 2. JWT specification

| Property | Value |
| --- | --- |
| Algorithm | HS256 |
| Library | `jose` (npm), already idiomatic for Next.js |
| Secret | `JWT_SECRET` env var, ≥32 bytes |
| TTL | 90 days |
| Storage on device | `EncryptedSharedPreferences` keyed by Android Keystore |

**Claims:**

```json
{
  "sub": "<customerId>",
  "name": "<customer name>",
  "phone": "<normalised phone>",
  "iat": 1718272800,
  "exp": 1726048800,
  "iss": "reyy-ev",
  "aud": "driver-app"
}
```

Verification (server) checks `iss`, `aud`, `exp`, signature.
Refresh strategy at v1: **none.** On `401` the native shell shows the login
screen. Drivers re-authenticate every 90 days. We can add refresh tokens
later if friction becomes an issue.

---

## 3. API contracts

Base URL: `https://<vercel-domain>` (configured in APK at build time).
All requests/responses are `Content-Type: application/json` unless otherwise
noted.

### 3.1 `POST /api/driver/login`

Public (no auth). Issues a JWT.

**Request:**
```json
{ "phone": "9876543210", "password": "..." }
```

`phone` may be sent with or without `+91`; the server normalises to digits
with country code. Bare 10-digit numbers are treated as `+91`.

**Responses:**

| Status | Body | When |
| --- | --- | --- |
| `200` | `{ "token": "...", "customer_id": "...", "customer_name": "..." }` | Success |
| `400` | `{ "error": "phone and password required" }` | Missing fields |
| `401` | `{ "error": "invalid credentials" }` | Wrong phone or password (do **not** distinguish — leaks signal) |
| `403` | `{ "error": "no active rental" }` | Customer has no active (un-ended) rental — driver can't use the app |
| `500` | `{ "error": "internal error" }` | Crash; details logged server-side |

**Notes:**
- Constant-time bcrypt verify happens even when the customer doesn't exist
  (compare against a fixed dummy hash) to make timing attacks against phone
  enumeration ineffective.
- Rate-limit: 5 attempts per phone per 5 minutes, in-memory at v1
  (Vercel is single-region for our purposes; if scale demands, move to
  Upstash Redis later — out of scope for v1).

### 3.2 `GET /api/driver/me`

JWT-auth required (`Authorization: Bearer <token>` or cookie set by the
WebView; see §6).

**Response (200):**

```json
{
  "customer_id": "...",
  "customer_name": "...",
  "phone": "+919876543210",
  "rental": {
    "id": "...",
    "scooty_label": "DL2C 1234",
    "start_date": "2026-04-01",
    "rate": 600,
    "rate_unit": "week",
    "weekly_rent": 600,
    "security_deposit": 5000,
    "deposit_collected": 3000,
    "deposit_pending": 2000,
    "total_paid": 1800,
    "outstanding": 0,
    "paid_through": "2026-06-21",
    "days_remaining": 7,
    "coverage_status": "paid"
  },
  "support_phone": "+91XXXXXXXXXX"
}
```

If the driver has no active rental, returns `403 { "error": "no active rental" }`.

**Implementation:** thin wrapper over existing `computeRentalBalances` from
`src/lib/billing.ts` plus a deposit-collected sum (same logic the dashboard
uses in `/api/dashboard`). Helper extracted to `src/lib/driverHome.ts`.

### 3.3 `POST /api/driver/location`

JWT-auth required. Upserts the LATEST row for the driver's active rental.

**Request:**
```json
{
  "lat": 28.6139,
  "lng": 77.2090,
  "accuracy": 12.5,
  "battery": 78,
  "captured_at": "2026-06-14T11:34:00.000Z"
}
```

**Validation:**
- `lat`: number, `-90 ≤ lat ≤ 90`.
- `lng`: number, `-180 ≤ lng ≤ 180`.
- `accuracy`: number ≥ 0, optional.
- `battery`: integer 0..100, optional.
- `captured_at`: ISO 8601, must be within the last 10 minutes (rejects
  replay).

**Responses:**

| Status | Body | When |
| --- | --- | --- |
| `204` | (no body) | Success |
| `400` | `{ "error": "invalid coordinates" }` etc. | Validation fail |
| `401` | `{ "error": "unauthorized" }` | Missing/expired JWT |
| `403` | `{ "error": "no active rental" }` | Driver has no active rental |

**DDB op:** `PutCommand` on the LATEST row. Idempotent overwrite.

### 3.4 `POST /api/admin/customers/[id]/set-driver-password`

Site-password cookie gated (existing dashboard auth).

**Request:**
```json
{ "password": "abcd1234" }   // or
{ "generate": true }
```

If `generate: true`, server generates an 8-char alphanumeric password
(no ambiguous chars: no `0/O/1/l`).

**Responses:**

| Status | Body | When |
| --- | --- | --- |
| `200` | `{ "ok": true, "password": "..." }` (echoes only when generated) | Success |
| `400` | `{ "error": "password too short" }` | < 6 chars |
| `404` | `{ "error": "customer not found" }` | |
| `409` | `{ "error": "phone already in use", "conflict_customer_id": "..." }` | Another customer owns the `PHONE#` row. The admin must resolve manually. |
| `422` | `{ "error": "customer has no phone" }` | Customer profile has no phone — set one first. |

**Implementation:** `TransactWriteCommand`:
1. Update customer profile, set `driverPasswordHash`.
2. Put `PHONE#<digits>` row with `ConditionExpression: attribute_not_exists(PK) OR customerId = :cid` so the admin can re-set the password without conflict, but a different customer can't steal the phone.

### 3.5 (Optional, v1.1) `GET /api/admin/locations`

Site-password gated. Lists every active rental's latest position.

**Response:**

```json
[
  {
    "rental_id": "...",
    "customer_id": "...",
    "customer_name": "...",
    "scooty_label": "...",
    "lat": 28.6,
    "lng": 77.2,
    "accuracy": 10,
    "battery": 78,
    "captured_at": "2026-06-14T11:34:00Z",
    "received_at": "2026-06-14T11:34:01Z",
    "seconds_stale": 53
  }
]
```

DDB op: `Query(GSI1, GSI1PK = "LOCATIONS")`. Returned items joined against
the active-rentals list to filter out closed rentals' orphaned rows.

### 3.6 Updates to existing routes

- **`src/proxy.ts`**: extend `matcher` to also exclude `/api/driver/*` and
  `/driver/*`. Driver auth happens inside the route handlers. New matcher:
  ```ts
  matcher: [
    "/((?!api/login|api/driver|driver|login|_next/static|_next/image|favicon.ico).*)",
  ]
  ```

- **`src/app/api/customers/route.ts`** (POST): when creating a customer with
  a phone, **do not** create the `PHONE#` row here. The phone uniqueness
  marker is created lazily on first password-set. This keeps the existing
  customer-create path free of new failure modes.

- **`src/app/api/customers/[id]/route.ts`** (PATCH/PUT): on phone change, if
  a `PHONE#` row exists for the old phone, transactionally move it to the
  new digits (delete old, put new with `attribute_not_exists` guard).

- **Rental close path** (existing `POST /api/rentals/[id]/...` close logic):
  best-effort `DeleteCommand` on `LOCATION#<rentalId>#LATEST`. Wrapped in
  try/catch — failure here does not abort the close.

---

## 4. Backend module reference

### 4.1 `src/lib/jwt.ts`

```ts
export interface DriverJwtClaims {
  sub: string;        // customerId
  name: string;
  phone: string;
  iat: number;
  exp: number;
  iss: "reyy-ev";
  aud: "driver-app";
}

export async function signDriverJwt(claims: Omit<DriverJwtClaims, "iat" | "exp" | "iss" | "aud">): Promise<string>;
export async function verifyDriverJwt(token: string): Promise<DriverJwtClaims>;
```

Uses `jose` (`SignJWT`, `jwtVerify`). Throws on invalid/expired.

### 4.2 `src/lib/driverAuth.ts`

```ts
export function normalisePhone(input: string): string | null;
//   "9876543210"   → "919876543210"
//   "+919876543210" → "919876543210"
//   "98 7654 3210"  → "919876543210"
//   "abc"           → null

export async function findCustomerByPhone(phone: string): Promise<{ customerId: string; name: string } | null>;
//   Reads PHONE#<digits> → resolves to CUSTOMER#<cid> profile.

export async function verifyDriverPassword(customerId: string, password: string): Promise<boolean>;
//   Reads CUSTOMER#<cid>/PROFILE, bcrypt.compare. Constant-time fallback when missing.

export async function setDriverPassword(customerId: string, password: string): Promise<void>;
//   bcrypt.hash, transact-write profile + PHONE# row.

export async function getActiveRentalForDriver(customerId: string): Promise<{ rentalId: string; scootyLabel: string } | null>;
```

### 4.3 `src/lib/driverHome.ts`

```ts
export interface DriverHomePayload { /* see §3.2 */ }

export async function buildDriverHomePayload(customerId: string): Promise<DriverHomePayload | null>;
//   Aggregates: profile + active rental + payments + deposits.
//   Returns null if no active rental.
```

Reuses `computeRentalBalances` from `src/lib/billing.ts`. Deposit summing
matches `src/app/api/dashboard/route.ts`.

### 4.4 `src/lib/location.ts`

```ts
export interface LocationPing {
  lat: number;
  lng: number;
  accuracy?: number;
  battery?: number;
  capturedAt: string; // ISO
}

export function isValidPing(input: unknown): input is LocationPing;
export async function upsertLatestLocation(customerId: string, rentalId: string, ping: LocationPing): Promise<void>;
```

### 4.5 New driver routes

Standard Next.js route handler pattern (`export async function POST` /
`GET`). Auth helper:

```ts
export async function requireDriverJwt(req: Request): Promise<DriverJwtClaims>;
//   Reads Authorization header OR `reyy_driver` cookie, verifies, returns
//   claims. Throws { status: 401 } on failure (caught by handler).
```

---

## 5. Driver-facing pages (rendered in WebView)

### 5.1 `/driver` (home)

Server component. Reads JWT from cookie (preferred) or rejects to login.
Calls `buildDriverHomePayload(customerId)`. Renders:

- Header: customer name, scooty label.
- Card 1: rent
  - rate (e.g. ₹600/week)
  - paid through DD MMM
  - days remaining (large, colour-coded green/amber/red)
- Card 2: deposit
  - target / collected / pending
- Card 3: payment
  - total paid / outstanding
- Footer: support phone (tap to dial), logout button.

Tailwind styling matches existing dashboard tokens (`emerald-*` for
positive, `red/amber-*` for warnings). Mobile-first single-column layout
(WebView width ≈ phone width).

### 5.2 `/driver/login` (optional)

Not used at v1 — login happens natively in `LoginActivity`. The native
shell hands the JWT to the WebView via `Authorization` header on the
initial load **and** sets a `reyy_driver` cookie via a one-time
`/driver/auth?token=...` callback page that:

1. Validates the token.
2. Sets `Set-Cookie: reyy_driver=<jwt>; HttpOnly; Secure; SameSite=Strict; Max-Age=7776000`.
3. Redirects to `/driver`.

This avoids the need for the WebView to inject headers on every navigation.

---

## 6. WebView ↔ native handoff

```
LoginActivity     POST /api/driver/login → JWT
  │
  ├─ store JWT in EncryptedSharedPreferences
  └─ start WebViewActivity with extra: webview_url = "/driver/auth?token=<JWT>"

WebViewActivity   loads /driver/auth?token=...
  │ → server sets cookie, 302 to /driver
  ↓
  /driver renders with cookie auth
```

The `?token=` round-trip happens once per launch and only on the loopback
to your own domain — no JWT ever crosses to a third party. The cookie is
HttpOnly (JavaScript in the WebView can't read it), so even an XSS in
`/driver/*` can't exfiltrate it.

---

## 7. Android — module reference

### 7.1 `LoginActivity`

- Layout: 2 inputs (phone, password) + button + error text.
- On submit:
  1. Validate phone (10 digits or `+91…`).
  2. `DriverApi.login(phone, password)` (suspend, on `Dispatchers.IO`).
  3. On success: `TokenStore.save(token)`, `OnboardingActivity` if first run, else `WebViewActivity`.
  4. On 401: show "Invalid phone or password".
  5. On other failure: show "Network error, try again".

### 7.2 `OnboardingActivity`

Three sequential cards. Each card explains in plain language and has a
single CTA. Once granted, advance.

| Card | Action | API |
| --- | --- | --- |
| 1. Location | "Allow Reyy EV to access your location all the time" | `ACCESS_FINE_LOCATION` then `ACCESS_BACKGROUND_LOCATION` (separate dialog on Android 10+) |
| 2. Battery | "Disable battery optimization for Reyy EV" | `Intent(ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)` |
| 3. Autostart | "Enable autostart on this phone" (text varies by OEM) | OEM-specific intent (see §7.6) |

After card 3, start `LocationForegroundService` and finish to `WebViewActivity`.

### 7.3 `WebViewActivity`

- Single full-screen `WebView`.
- Settings:
  - `javaScriptEnabled = true`
  - `domStorageEnabled = true`
  - `cacheMode = LOAD_DEFAULT`
  - `setSupportZoom(false)`
- Loads `${API_BASE_URL}/driver/auth?token=${token}`.
- Pull-to-refresh wraps the WebView.
- Override URL loading to keep navigation in-WebView.
- Handles `tel:` and `mailto:` via `Intent.ACTION_DIAL`.
- On `onResume`: triggers an immediate location push (the "everytime user
  opens an app, send current location" requirement).

### 7.4 `LocationForegroundService`

```kotlin
class LocationForegroundService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private lateinit var fused: FusedLocationProviderClient
    private lateinit var alarmManager: AlarmManager

    override fun onCreate() {
        startForeground(NOTIF_ID, buildNotification())
        fused = LocationServices.getFusedLocationProviderClient(this)
        scheduleNextAlarm()
        // Schedule WorkManager watchdog if not already.
        LocationWatchdogWorker.enqueueIfAbsent(applicationContext)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        return START_STICKY
    }

    fun pushNow() {
        scope.launch {
            val loc = fused.getCurrentLocation(...).await()
            DriverApi.location(LocationPing.from(loc)).runCatching { /* … */ }
        }
    }

    private fun scheduleNextAlarm() {
        val pi = LocationAlarmReceiver.pendingIntent(this)
        val wakeAt = SystemClock.elapsedRealtime() + 60_000L
        alarmManager.setExactAndAllowWhileIdle(
            AlarmManager.ELAPSED_REALTIME_WAKEUP, wakeAt, pi
        )
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }
}
```

Notification copy (§02 §8): title `Reyy EV`, body `Connected. Tap to open.`,
intent → `WebViewActivity`. Channel importance `LOW` (silent, no sound).

### 7.5 Resilience layers

| Layer | Trigger | Action |
| --- | --- | --- |
| `START_STICKY` | OS kills service | OS restarts via `onStartCommand` |
| `LocationAlarmReceiver` | Every 60s alarm | Wakes, holds wakelock 10s, asks service to push, reschedules |
| `LocationWatchdogWorker` | WorkManager every 15 min (minimum) | Checks `ActivityManager.RunningAppProcesses` for `:location`; if missing, `startForegroundService()` |
| `BootReceiver` | `BOOT_COMPLETED`, `LOCKED_BOOT_COMPLETED`, `MY_PACKAGE_REPLACED` | `startForegroundService()` |
| Separate process | crashes in main process | service in `:location` process keeps running |

Watchdog enqueue in `Application.onCreate`:

```kotlin
WorkManager.getInstance(this).enqueueUniquePeriodicWork(
    "reyy_loc_watchdog",
    ExistingPeriodicWorkPolicy.KEEP,
    PeriodicWorkRequestBuilder<LocationWatchdogWorker>(15, MINUTES).build()
)
```

### 7.6 OEM autostart deep-links

A static map of intents per OEM, tried in order until one resolves:

| OEM | Component |
| --- | --- |
| Xiaomi | `com.miui.securitycenter/com.miui.permcenter.autostart.AutoStartManagementActivity` |
| Oppo | `com.coloros.safecenter/.permission.startup.StartupAppListActivity` (and 2 fallbacks) |
| Vivo | `com.iqoo.secure/.MainActivity` (and 1 fallback) |
| Realme | same as Oppo |
| OnePlus (older) | `com.oneplus.security/.chainlaunch.view.ChainLaunchAppListActivity` |
| Honor / Huawei | `com.huawei.systemmanager/.startupmgr.ui.StartupNormalAppListActivity` |
| Samsung | not needed (stock Android behaviour) |

Detection by `Build.MANUFACTURER`. If no match or the intent fails to resolve,
the card is silently skipped (rare devices).

### 7.7 `TokenStore` (EncryptedSharedPreferences)

```kotlin
object TokenStore {
    private lateinit var prefs: SharedPreferences

    fun init(ctx: Context) {
        val masterKey = MasterKey.Builder(ctx)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        prefs = EncryptedSharedPreferences.create(
            ctx, "reyy_secure", masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    fun save(token: String) = prefs.edit().putString("jwt", token).apply()
    fun get(): String? = prefs.getString("jwt", null)
    fun clear() = prefs.edit().remove("jwt").apply()
}
```

### 7.8 `DriverApi` (Retrofit + Moshi)

```kotlin
interface DriverApi {
    @POST("api/driver/login")
    suspend fun login(@Body req: LoginRequest): LoginResponse

    @POST("api/driver/location")
    suspend fun location(@Body req: LocationPing): Response<Unit>
}
```

Built once in `ReyyApp.onCreate` with an `AuthInterceptor` that adds
`Authorization: Bearer <TokenStore.get()>` to every request except login.

---

## 8. Manifest essentials

```xml
<uses-permission android:name="android.permission.INTERNET"/>
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION"/>
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION"/>
<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION"/>
<uses-permission android:name="android.permission.FOREGROUND_SERVICE"/>
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION"/>
<uses-permission android:name="android.permission.WAKE_LOCK"/>
<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED"/>
<uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>
<uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM"/>
<uses-permission android:name="android.permission.USE_EXACT_ALARM"/>
<uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS"/>

<application
    android:name=".ReyyApp"
    android:allowBackup="false"
    android:usesCleartextTraffic="false"
    ...>

  <activity android:name=".ui.LoginActivity" android:exported="true">
    <intent-filter>
      <action android:name="android.intent.action.MAIN"/>
      <category android:name="android.intent.category.LAUNCHER"/>
    </intent-filter>
  </activity>
  <activity android:name=".ui.OnboardingActivity" android:exported="false"/>
  <activity android:name=".ui.WebViewActivity" android:exported="false"/>

  <service
      android:name=".service.LocationForegroundService"
      android:foregroundServiceType="location"
      android:exported="false"
      android:process=":location"/>

  <receiver android:name=".service.LocationAlarmReceiver"
            android:exported="false"
            android:process=":location"/>

  <receiver android:name=".service.BootReceiver" android:exported="true">
    <intent-filter>
      <action android:name="android.intent.action.BOOT_COMPLETED"/>
      <action android:name="android.intent.action.LOCKED_BOOT_COMPLETED"/>
      <action android:name="android.intent.action.MY_PACKAGE_REPLACED"/>
    </intent-filter>
  </receiver>
</application>
```

---

## 9. Error model (end-to-end)

| Scenario | Native shell behaviour |
| --- | --- |
| 401 from any driver API | Clear `TokenStore`; show `LoginActivity` |
| 403 "no active rental" on `/me` | Show "No active rental — contact ops" screen with support phone |
| 5xx | Toast "Network error", auto-retry on next minute |
| No network on location push | Drop the ping; next minute will succeed |
| Permission revoked at runtime | `LocationForegroundService` posts a notification "Reyy EV needs location" → tap opens `OnboardingActivity` |

---

## 10. Configuration matrix

| Build flavour | `API_BASE_URL` | `applicationIdSuffix` | Notes |
| --- | --- | --- | --- |
| `debug` | `https://reyy-ev-staging.vercel.app` (placeholder; set per project) | `.debug` | Logs verbose, enables WebView debugging |
| `release` | `https://<your-prod-domain>` | (none) | R8/ProGuard on, logs WARN+ only |

Vercel env vars (production):

| Name | Value | Used by |
| --- | --- | --- |
| `AWS_REGION` | `ap-south-1` | existing |
| `AWS_ACCESS_KEY_ID` | … | existing |
| `AWS_SECRET_ACCESS_KEY` | … | existing |
| `DYNAMODB_TABLE` | `ReyyEV` | existing |
| `S3_BUCKET` | `reyyev-media` | existing |
| `SITE_PASSWORD` | … | existing |
| `JWT_SECRET` | new — generate with `openssl rand -base64 48` | driver auth |
