# 05 — Tasks for Antigravity (Other IDE)

This is the **executable artifact**. Each task is self-contained: read it,
do the work, satisfy the acceptance criterion, commit. Tasks are numbered
`T<phase>.<index>`. Dependencies are explicit. Do not skip ahead — later
tasks assume earlier ones are done.

**Conventions for every task:**
- The agent must read `docs/driver-app/01-coding-spec.md` and
  `docs/driver-app/03-low-level-design.md` before starting.
- Make one git commit per task with a Conventional Commits message.
- Run `npm run lint && npm run build` (or the Android equivalent) before
  committing. If either fails, fix before moving on.
- The acceptance criterion is the **proof** — produce its output and paste
  it into the commit message body.

**Repo layout after these tasks:**

```
reyy-ev-main/
├── src/                     ← existing reyy-ev (modified per Phase 1–3 tasks)
├── android/                 ← new Android project (created in T4.1)
├── docs/driver-app/         ← these docs
└── ...
```

---

## Phase 1 — Backend foundation

### T1.1 — Add npm dependencies

**Files:** `package.json`, `package-lock.json`

**Steps:**
1. `npm install bcryptjs@^2 jose@^5`
2. `npm install --save-dev @types/bcryptjs`
3. Verify `package.json` shows the new entries under `dependencies` and
   `devDependencies`.

**Acceptance:**
- `npm ls bcryptjs jose` lists both at expected versions.
- `npm run build` is clean.

**Commit:** `chore(deps): add bcryptjs and jose for driver auth`

---

### T1.2 — Add JWT_SECRET environment variable

**Files:** `.env.example` (create or update)

**Steps:**
1. If `.env.example` does not exist, create it with the existing required
   vars (`AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
   `DYNAMODB_TABLE`, `S3_BUCKET`, `SITE_PASSWORD`).
2. Append `JWT_SECRET=` with a comment:

   ```
   # 32+ byte random string. Generate with: openssl rand -base64 48
   # Required for driver app login. Rotating invalidates all driver tokens.
   JWT_SECRET=
   ```

3. Tell the operator (in the commit body) to set `JWT_SECRET` in Vercel
   Project Settings → Environment Variables for both Preview and Production.

**Acceptance:** `.env.example` contains the new var with documentation.

**Commit:** `chore: document JWT_SECRET env var`

---

### T1.3 — Create `src/lib/jwt.ts`

**Depends on:** T1.1

**Files:** `src/lib/jwt.ts` (new)

**Implementation:** per LLD §4.1. Use `jose`'s `SignJWT` and `jwtVerify`.
Issuer `reyy-ev`, audience `driver-app`, 90-day expiry. Throws on
verification failure.

**Acceptance:** add a temporary `src/app/api/admin/_smoke/route.ts` that
signs a token then verifies it and returns `{ ok: true, sub: claims.sub }`.
Run locally with `npm run dev`, hit it, confirm `{ ok: true }`. **Delete
the smoke route in the same commit.**

**Commit:** `feat(driver): add JWT helpers for driver auth`

---

### T1.4 — Create `src/lib/driverAuth.ts`

**Depends on:** T1.1, T1.3

**Files:** `src/lib/driverAuth.ts` (new)

**Implementation:** per LLD §4.2. Functions:
- `normalisePhone(input)`
- `findCustomerByPhone(phone)`
- `verifyDriverPassword(customerId, password)` — constant-time fallback when
  the customer is missing (bcrypt-compare against a fixed dummy hash).
- `setDriverPassword(customerId, password)` — `TransactWriteCommand` updates
  profile and writes/updates `PHONE#<digits>` row.
- `getActiveRentalForDriver(customerId)` — Query under `CUSTOMER#<cid>`
  with `begins_with(SK, "RENTAL#")`, return the one with `endDate` absent.

**Acceptance:** add a temporary smoke route that calls
`setDriverPassword(<test cid>, "test12")`, then `verifyDriverPassword(...)`,
returns `{ ok: true }`. After it works, delete the smoke route. Confirm in
DDB the `PHONE#<digits>` row was created.

**Commit:** `feat(driver): add phone+password lookup and password set`

---

### T1.5 — Create `src/lib/driverHome.ts`

**Depends on:** T1.4

**Files:** `src/lib/driverHome.ts` (new)

**Implementation:** per LLD §4.3 and HLD §3.2. Reuse
`computeRentalBalances` from `src/lib/billing.ts`. Sum `DEPOSIT#<rid>#…`
rows for the active rental to get `deposit_collected`. Read
`SUPPORT_PHONE` env var (optional) for the support number; if absent, omit.

**Acceptance:** smoke route that calls `buildDriverHomePayload(<test cid>)`
returns the expected JSON shape. Delete smoke route after.

**Commit:** `feat(driver): build home page payload`

---

### T1.6 — Create `src/lib/location.ts`

**Depends on:** none

**Files:** `src/lib/location.ts` (new)

**Implementation:** per LLD §4.4.
- `LocationPing` interface.
- `isValidPing(input): input is LocationPing` type predicate validating
  ranges and `captured_at` freshness (≤10 min).
- `upsertLatestLocation(customerId, rentalId, ping)` writes the LATEST row
  with all attributes from LLD §1.3.

**Acceptance:** smoke route writes a sample ping, then `aws dynamodb
get-item --key '{"PK":{"S":"CUSTOMER#<cid>"},"SK":{"S":"LOCATION#<rid>#LATEST"}}'`
returns the row. Delete smoke route.

**Commit:** `feat(driver): add location ping validator and DDB upsert`

---

### T1.7 — Update `src/proxy.ts` matcher

**Files:** `src/proxy.ts`

**Steps:** change the matcher to:

```ts
matcher: [
  "/((?!api/login|api/driver|driver|login|_next/static|_next/image|favicon.ico).*)",
],
```

Add a comment above explaining: driver routes have their own JWT auth and
must bypass the site-password gate.

**Acceptance:** `npm run dev`, hit
`http://localhost:3000/api/driver/login` — currently this returns 404 (route
doesn't exist yet) **without** redirecting to `/login`. That confirms the
matcher change took effect.

**Commit:** `feat(driver): exclude driver routes from site-password gate`

---

## Phase 2 — Backend driver routes

### T2.1 — `POST /api/admin/customers/[id]/set-driver-password`

**Depends on:** T1.4, T1.7

**Files:** `src/app/api/admin/customers/[id]/set-driver-password/route.ts` (new)

**Implementation:** per LLD §3.4. Site-password cookie gated automatically
by `proxy.ts`. Body: `{ password? : string, generate?: true }`. If
`generate: true`, generate 8-char alphanumeric (no `0`, `O`, `1`, `l`).
Validate ≥6 chars. Calls `setDriverPassword`. Returns `{ ok: true,
password? }` (echoes only when generated).

**Acceptance:**
```bash
curl -X POST https://<vercel>/api/admin/customers/<cid>/set-driver-password \
  -H "Content-Type: application/json" \
  -H "Cookie: reyy_auth=<hash>" \
  -d '{"generate": true}'
# → { ok: true, password: "..." }
```

DDB: customer profile has `driverPasswordHash`; `PHONE#<digits>` row exists.

**Commit:** `feat(admin): add set-driver-password route`

---

### T2.2 — `POST /api/driver/login`

**Depends on:** T1.3, T1.4

**Files:** `src/app/api/driver/login/route.ts` (new)

**Implementation:** per LLD §3.1.
1. Validate body shape.
2. Normalise phone.
3. `findCustomerByPhone` → if not found, still call
   `verifyDriverPassword` against a dummy hash (constant-time).
4. If verify fails → 401.
5. `getActiveRentalForDriver` → if no active rental, return 403 "no active
   rental".
6. `signDriverJwt({ sub, name, phone })` → return `{ token, customer_id,
   customer_name }`.

Add an in-memory rate limit (5 attempts per phone per 5 min). Use a
top-level `Map<string, { count: number; resetAt: number }>`. Reset on hit
after `resetAt`.

**Acceptance:**
```bash
curl -X POST https://<vercel>/api/driver/login \
  -H "Content-Type: application/json" \
  -d '{"phone":"<digits>","password":"<from T2.1>"}'
# → { token: "eyJ...", customer_id: "...", customer_name: "..." }
```

Wrong password returns 401. Rate limit kicks in on the 6th attempt.

**Commit:** `feat(driver): add login endpoint`

---

### T2.3 — `GET /api/driver/me`

**Depends on:** T1.3, T1.5, T2.2

**Files:** `src/app/api/driver/me/route.ts` (new), `src/lib/driverRequest.ts` (new helper)

**Implementation:**
- `requireDriverJwt(req)` helper in `src/lib/driverRequest.ts`. Reads
  `Authorization: Bearer <token>` first, falls back to `reyy_driver`
  cookie. Verifies via `verifyDriverJwt`. Throws on failure.
- The route handler catches the auth error → returns 401.
- Calls `buildDriverHomePayload(claims.sub)`. Null → 403 "no active rental".
- Returns the payload.

**Acceptance:**
```bash
curl https://<vercel>/api/driver/me \
  -H "Authorization: Bearer <token from T2.2>"
# → full home payload
```

**Commit:** `feat(driver): add /api/driver/me`

---

### T2.4 — `POST /api/driver/location`

**Depends on:** T1.6, T2.3

**Files:** `src/app/api/driver/location/route.ts` (new)

**Implementation:** per LLD §3.3.
1. `requireDriverJwt`.
2. Read body, run `isValidPing`.
3. `getActiveRentalForDriver(claims.sub)` → null → 403.
4. `upsertLatestLocation(claims.sub, rental.rentalId, ping)`.
5. Return `204`.

**Acceptance:**
```bash
curl -i -X POST https://<vercel>/api/driver/location \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"lat":28.6,"lng":77.2,"battery":80,"captured_at":"<now ISO>"}'
# → HTTP/1.1 204
```

DDB inspect: `LOCATION#<rid>#LATEST` row exists with the values.

**Commit:** `feat(driver): add /api/driver/location`

---

### T2.5 — `/driver/auth` page (token → cookie redirect)

**Depends on:** T1.3, T1.7

**Files:** `src/app/driver/auth/route.ts` (new — Route Handler, not page)

**Implementation:** Next.js Route Handler `GET`. Reads `?token=...` query
param, verifies it via `verifyDriverJwt`. On success:
- Sets cookie:
  ```ts
  res.cookies.set("reyy_driver", token, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/driver",
    maxAge: 90 * 24 * 60 * 60,
  });
  ```
- 302 redirect to `/driver`.

On failure: 401 JSON `{ error: "invalid token" }` (the WebView detects this
and bounces back to native login).

**Acceptance:** browser visit
`https://<vercel>/driver/auth?token=<valid>` redirects to `/driver` and
sets the cookie. With an invalid token, returns 401.

**Commit:** `feat(driver): add /driver/auth token handoff`

---

### T2.6 — Rental close: best-effort delete LATEST row

**Files:** existing rental-close handler(s) — search for `endDate` writes
in `src/app/api/rentals/[id]/...`. Likely candidates: a PATCH endpoint or
a `pull` route.

**Implementation:** wherever a rental is closed (set `endDate`), append a
best-effort `DeleteCommand` for `LOCATION#<rid>#LATEST`, wrapped in
try/catch with a `console.warn` on failure. Comment why best-effort:
"Stale row is harmless because dashboard filters by active rental; we just
don't want it cluttering the LOCATIONS GSI partition."

**Acceptance:** close a rental in the dashboard, confirm the LATEST row is
deleted in DDB. If the LATEST row was never written, no error.

**Commit:** `feat(driver): clean up location row on rental close`

---

### T2.7 — (Optional) `GET /api/admin/locations`

**Files:** `src/app/api/admin/locations/route.ts` (new)

**Implementation:** per LLD §3.5. Site-password gated. Query GSI1 with
`GSI1PK = "LOCATIONS"`. Join against active rentals (filter out closed).
Compute `seconds_stale = now - capturedAt`.

**Acceptance:** with one known driver pinging, this endpoint returns one
entry with the correct `customer_name` and `seconds_stale < 90`.

**Commit:** `feat(admin): add live locations list endpoint`

---

## Phase 3 — Dashboard surfaces

### T3.1 — `/driver` home page

**Depends on:** T1.5, T2.5

**Files:** `src/app/driver/page.tsx` (new), `src/app/driver/layout.tsx`
(new — minimal mobile layout, no nav)

**Implementation:** per LLD §5.1. Server component.
- Read `reyy_driver` cookie via `cookies()` from `next/headers`.
- `verifyDriverJwt` → on failure, render a minimal "Session expired" page
  with a JS bridge call: `<script>Android?.logout?.();</script>` then a
  `<a href="/driver/auth">try again</a>`.
- `buildDriverHomePayload(sub)` → null → render "No active rental — contact
  ops" with the support phone.
- Otherwise render the three cards (rent / deposit / payment) plus
  customer name and scooty label at top.

Styling: Tailwind, mobile-first, single column, generous touch targets
(min 44px). Match emerald/amber/red colour tokens used in the existing
dashboard.

**Acceptance:** visit `/driver` after `/driver/auth` round-trip in the
browser. The page renders the test driver's data correctly. View source:
no JWT in HTML.

**Commit:** `feat(driver): add /driver home page`

---

### T3.2 — Logout endpoint

**Depends on:** T3.1

**Files:** `src/app/driver/logout/route.ts` (new)

**Implementation:** clear `reyy_driver` cookie, return 204. The WebView
calls this then invokes `Android.logout()` JS bridge which clears
`TokenStore` and restarts the app at login.

**Acceptance:** `curl -i https://<vercel>/driver/logout -H "Cookie: reyy_driver=..."` returns 204 with `Set-Cookie: reyy_driver=; Max-Age=0`.

**Commit:** `feat(driver): add logout route`

---

### T3.3 — Admin: "Driver login" section in customer detail

**Depends on:** T2.1

**Files:** `src/app/customers/[id]/page.tsx` (modify — find the right place
in the existing layout)

**Implementation:** add a section labelled **Driver login** with:
- "Status: ✓ Password set" if `driverPasswordHash` is present, else
  "Not set".
- Two buttons: **Set password** (manual entry) and **Generate password**.
- On click: `POST /api/admin/customers/[id]/set-driver-password`. On
  success of "generate", show the password in a modal with a "Copy" button
  and a warning: "This password is only shown now. Copy it and share with
  the driver in person."

The customer detail page is currently 16k chars; touch only the section
needed. Match existing style (rounded card, Tailwind utility classes).

**Acceptance:** open a customer detail page, set a password via the UI, log
in via the curl flow. Reload — status reads "Password set". Click reset,
get a new password, confirm login still works with new and 401s with old.

**Commit:** `feat(admin): add driver-password UI to customer detail`

---

### T3.4 — Admin: "Last seen" hint on customer detail

**Depends on:** T2.4

**Files:** `src/app/customers/[id]/page.tsx` (small additional change)

**Implementation:** on the customer detail page (or in the active rental
sub-card), if a `LOCATION#<rid>#LATEST` row exists for the active rental,
show:
- "Last seen: \<relative time\> · \<lat\>, \<lng\>"
- Tappable link to Google Maps: `https://maps.google.com/?q=<lat>,<lng>`.

If older than 10 min, render in red ("Tracker offline 12 min").

**Acceptance:** with a driver pinging from T2.4, the customer detail shows
"Last seen: a few seconds ago".

**Commit:** `feat(admin): show last-seen tracker info on customer detail`

---

### T3.5 — (Optional, defer) Live map dashboard page

**Files:** `src/app/admin/map/page.tsx` (new)

**Implementation:** Leaflet + OpenStreetMap (free). One marker per active
rental from `/api/admin/locations`. Auto-refresh every 30s. Click marker
shows customer name, scooty, last seen.

**Acceptance:** map renders with at least one marker for the test driver.

**Commit:** `feat(admin): add live map of active rentals`

---

## Phase 4 — Android shell

### T4.1 — Bootstrap Android project

**Files:** `android/` (new directory tree)

**Steps:**
1. Use Android Studio "New Project → Empty Activity (Kotlin)" or run
   `gradle init` with the appropriate template.
2. Settings:
   - **Package:** `in.reyyev.driver`
   - **Application ID:** `in.reyyev.driver`
   - **minSdk:** 26 (Android 8.0)
   - **targetSdk:** 34
   - **compileSdk:** 34
   - **AGP:** 8.x
   - **Kotlin:** 1.9+
   - **Build language:** Kotlin DSL (`build.gradle.kts`)
3. Create the directory layout per Spec §5.1 (empty packages for now).
4. Add a top-level `android/.gitignore` (Android Studio default + `local.properties`).
5. Verify `./gradlew assembleDebug` produces a debug APK that installs and
   shows the default Empty Activity.

**Acceptance:** APK installs on a real device, opens, shows "Hello".

**Commit:** `feat(android): bootstrap project skeleton`

---

### T4.2 — Add dependencies and BuildConfig

**Files:** `android/app/build.gradle.kts`

**Steps:**
1. Add deps:
   ```kotlin
   implementation("androidx.core:core-ktx:1.13.1")
   implementation("androidx.appcompat:appcompat:1.7.0")
   implementation("com.google.android.material:material:1.12.0")
   implementation("androidx.constraintlayout:constraintlayout:2.1.4")
   implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.4")
   implementation("androidx.work:work-runtime-ktx:2.9.0")
   implementation("androidx.security:security-crypto:1.1.0-alpha06")
   implementation("com.google.android.gms:play-services-location:21.3.0")
   implementation("com.squareup.retrofit2:retrofit:2.11.0")
   implementation("com.squareup.retrofit2:converter-moshi:2.11.0")
   implementation("com.squareup.okhttp3:okhttp:4.12.0")
   implementation("com.squareup.okhttp3:logging-interceptor:4.12.0")
   implementation("com.squareup.moshi:moshi-kotlin:1.15.1")
   implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
   implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.8.1")
   ```
2. Configure `buildTypes`:
   ```kotlin
   defaultConfig {
       buildConfigField("String", "API_BASE_URL", "\"https://<staging-vercel>.vercel.app\"")
   }
   buildTypes {
       release {
           isMinifyEnabled = true
           proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
           buildConfigField("String", "API_BASE_URL", "\"https://<prod-vercel>.vercel.app\"")
       }
       debug {
           applicationIdSuffix = ".debug"
       }
   }
   buildFeatures {
       buildConfig = true
       viewBinding = true
   }
   ```

**Acceptance:** `./gradlew assembleDebug` succeeds. `BuildConfig.API_BASE_URL`
is referenceable.

**Commit:** `feat(android): add dependencies and build config`

---

### T4.3 — Application class, TokenStore, Logger

**Depends on:** T4.2

**Files:**
- `app/src/main/java/in/reyyev/driver/ReyyApp.kt`
- `app/src/main/java/in/reyyev/driver/net/TokenStore.kt`
- `app/src/main/java/in/reyyev/driver/util/Logger.kt`
- `app/src/main/java/in/reyyev/driver/util/Constants.kt`
- `AndroidManifest.xml` (set `android:name=".ReyyApp"`, `allowBackup=false`,
  `usesCleartextTraffic=false`)

**Implementation:**
- `TokenStore`: per LLD §7.7. EncryptedSharedPreferences wrapping a JWT.
  Methods: `init(ctx)`, `save(token)`, `get()`, `clear()`,
  `setOnboardingComplete()`, `isOnboardingComplete()`.
- `Logger`: wraps `android.util.Log`, strips PII keys. Methods: `d/i/w/e`.
- `Constants`: `NOTIF_CHANNEL_ID = "reyy_status"`, `NOTIF_ID = 7301`,
  `LOCATION_INTERVAL_MS = 60_000L`, etc.
- `ReyyApp.onCreate`: `TokenStore.init(this)`, create the notification
  channel (importance LOW).

**Acceptance:** App still starts. Add a temporary `Logger.d("test", "hello")`
in `onCreate` and confirm it's visible only in debug build.

**Commit:** `feat(android): add ReyyApp, TokenStore, Logger`

---

### T4.4 — Retrofit + DriverApi + AuthInterceptor

**Depends on:** T4.3

**Files:**
- `net/ApiClient.kt`
- `net/DriverApi.kt`
- `net/AuthInterceptor.kt`
- `net/dto/LoginRequest.kt`, `LoginResponse.kt`, `LocationPing.kt`

**Implementation:** per LLD §7.8. `ApiClient.driverApi: DriverApi` lazy
singleton. `AuthInterceptor` reads `TokenStore.get()` and adds
`Authorization: Bearer ...` to all requests except those with header
`X-Skip-Auth: true` (used by login). Timeouts 10s.

**Acceptance:** unit-test-style: from a debug-only `MainActivity` button,
call `ApiClient.driverApi.login(...)` against the staging Vercel and log
the response. Confirm a token comes back.

**Commit:** `feat(android): add Retrofit-based DriverApi`

---

### T4.5 — `LoginActivity`

**Depends on:** T4.4

**Files:** `ui/LoginActivity.kt`, `res/layout/activity_login.xml`,
`res/values/strings.xml` (login_*)

**Implementation:** per LLD §7.1.
- Two `EditText` (phone, password), a `Button`, a `TextView` for error.
- On submit: validate phone (10 digits or `+91…`), call
  `ApiClient.driverApi.login` on `Dispatchers.IO`.
- Success: `TokenStore.save(token)`, `startActivity` to
  `OnboardingActivity` if `!isOnboardingComplete()`, else `WebViewActivity`.
  Finish.
- 401: show "Invalid phone or password" in the error TextView.
- Other failure: "Network error, please try again."

Also:
- Wire `LoginActivity` as the launcher activity.
- App-start logic: if `TokenStore.get() != null`, immediately route to
  `WebViewActivity` (no login screen). Implement this in `onCreate`.

**Acceptance:** APK installs, log in with credentials from T2.1, see the
WebView load... but it'll fail since `WebViewActivity` is a stub. The
logcat should show a successful HTTP 200 from `/api/driver/login` and a
JWT being saved. Verify by reinstalling and confirming login skip.

**Commit:** `feat(android): add LoginActivity`

---

### T4.6 — `WebViewActivity`

**Depends on:** T4.5, T2.5, T3.1

**Files:** `ui/WebViewActivity.kt`, `res/layout/activity_webview.xml`

**Implementation:** per LLD §7.3.
- Full-screen WebView.
- Settings: javaScript, DOM storage, no zoom.
- `loadUrl("${BuildConfig.API_BASE_URL}/driver/auth?token=${token}")` once
  on create.
- `WebViewClient.shouldOverrideUrlLoading`: stay in-WebView for our domain;
  for `tel:`, `mailto:`, external https, hand off to system intents.
- `JavaScriptInterface` with one method: `logout()` which clears
  TokenStore and restarts at LoginActivity. Expose via
  `addJavascriptInterface(this, "Android")`.
- Hardware back button: WebView back if possible, else exit.
- `onResume`: send broadcast `in.reyyev.driver.PUSH_NOW` (consumed by the
  service in Phase 5; now it's a no-op).

**Acceptance:** after login, WebView shows the home page from T3.1 with
real data. `tel:` links open the dialer. Back button returns through
history. Calling `Android.logout()` from JS console (debug only) lands at
LoginActivity.

**Commit:** `feat(android): add WebViewActivity`

---

## Phase 5 — Foreground service + resilience

### T5.1 — `LocationForegroundService` skeleton

**Depends on:** T4.6

**Files:**
- `service/LocationForegroundService.kt`
- `AndroidManifest.xml` (add the service entry from LLD §8)

**Implementation:** per LLD §7.4.
- `onCreate`: `startForeground(NOTIF_ID, buildNotification())`. Notification
  copy exactly: title `Reyy EV`, body `Connected. Tap to open.`, icon
  white-on-transparent, channel LOW.
- `onStartCommand`: return `START_STICKY`.
- Manifest entry includes `android:foregroundServiceType="location"`,
  `android:process=":location"`.
- Start the service from `OnboardingActivity` on completion, **and** from
  `LoginActivity` on resume if onboarding is already complete.

**Acceptance:** install, log in. The persistent notification appears.
`adb shell dumpsys activity services | grep LocationForeground` shows the
service running. Swipe app from Recents — service is still listed.

**Commit:** `feat(android): add LocationForegroundService scaffold`

---

### T5.2 — `LocationAlarmReceiver` and 60s loop

**Depends on:** T5.1

**Files:**
- `service/LocationAlarmReceiver.kt`
- update `LocationForegroundService.kt` to schedule the first alarm

**Implementation:**
- `scheduleNextAlarm()` in service: `setExactAndAllowWhileIdle`, 60s out,
  `ELAPSED_REALTIME_WAKEUP`. PendingIntent immutable.
- `LocationAlarmReceiver.onReceive`:
  1. Acquire `PowerManager.PARTIAL_WAKE_LOCK` with 10s timeout.
  2. Get `FusedLocationProviderClient.getCurrentLocation(PRIORITY_HIGH_ACCURACY, null)`.
  3. POST `/api/driver/location` with a `LocationPing`.
  4. Release wakelock.
  5. Re-schedule the next alarm.
- All async on `Dispatchers.IO`; receiver uses `goAsync()`.

Permissions check in receiver: if `ACCESS_FINE_LOCATION` not granted, skip
silently (don't crash).

**Acceptance:** install, log in, wait 5 min. DDB shows
`LOCATION#<rid>#LATEST` with `capturedAt` updating every minute. Pings
also visible as `204`s in the Vercel logs.

**Commit:** `feat(android): add 60s location alarm loop`

---

### T5.3 — `LocationWatchdogWorker`

**Depends on:** T5.2

**Files:** `service/LocationWatchdogWorker.kt`

**Implementation:**
- WorkManager periodic, 15-min interval, unique work
  `reyy_loc_watchdog`, `KEEP` policy.
- `doWork()`: check if service `:location` process is running via
  `ActivityManager.getRunningAppProcesses()` (or a static
  `LocationForegroundService.isRunning` flag). If not running and a JWT
  exists in `TokenStore`, call `ContextCompat.startForegroundService(...)`.
- Enqueue from `ReyyApp.onCreate`.

**Acceptance:** force-stop the app via `adb shell am force-stop in.reyyev.driver`.
Wait up to 15 min. Service revives. Confirm by DDB row update and
notification reappearing.

(Note: on some OEMs, force-stop also disables WorkManager; this is
expected. Layer 10 — server-side stale alert — handles that.)

**Commit:** `feat(android): add WorkManager watchdog for location service`

---

### T5.4 — `BootReceiver`

**Depends on:** T5.1

**Files:** `service/BootReceiver.kt`, `AndroidManifest.xml` (entry from §8)

**Implementation:**
- Receives `BOOT_COMPLETED`, `LOCKED_BOOT_COMPLETED`, `MY_PACKAGE_REPLACED`.
- If `TokenStore.get() != null` and onboarding complete, call
  `ContextCompat.startForegroundService(...)`.
- For `LOCKED_BOOT_COMPLETED`, the device is in direct-boot mode.
  `EncryptedSharedPreferences` is **not** available before user unlock
  (relies on user credential-encrypted storage). Solution: in this case,
  do nothing — wait for the post-unlock `BOOT_COMPLETED` (always fires).
  Comment this in the code.

**Acceptance:** reboot the device. After unlock, within 60s the location
service is running and the next ping lands in DDB.

**Commit:** `feat(android): revive service on boot and package replace`

---

### T5.5 — Immediate ping on app open

**Depends on:** T5.2

**Files:** `ui/WebViewActivity.kt` (touch), `service/LocationForegroundService.kt`

**Implementation:**
- In `WebViewActivity.onResume`, send a broadcast
  `in.reyyev.driver.PUSH_NOW` (or directly call a service-bound method).
- Service handles `PUSH_NOW`: triggers an immediate ping (out-of-band
  with the alarm loop).
- Don't break the alarm loop's schedule.

**Acceptance:** open the app from a cold start; within 5 seconds, DDB has
a fresh `LOCATION#…` row with `capturedAt` ≈ now.

**Commit:** `feat(android): push location immediately on app foreground`

---

### T5.6 — Logout flow

**Depends on:** T4.6, T5.1

**Files:** `ui/WebViewActivity.kt` (touch), `service/LocationForegroundService.kt`

**Implementation:**
- `Android.logout()` JS bridge:
  1. Stop `LocationForegroundService`.
  2. Cancel WorkManager unique work.
  3. Cancel any pending alarm.
  4. `TokenStore.clear()`.
  5. Start `LoginActivity` with `FLAG_ACTIVITY_CLEAR_TASK | NEW_TASK`.
- Logout button on `/driver` calls
  `fetch("/driver/logout", {method:"POST"}).then(()=>Android.logout())`.

**Acceptance:** tap logout in WebView. Land at LoginActivity. Notification
disappears. DDB stops receiving pings within ~2 minutes.

**Commit:** `feat(android): wire logout to clear state and stop service`

---

## Phase 6 — Permissions onboarding

### T6.1 — `OnboardingActivity` skeleton

**Depends on:** T4.5

**Files:**
- `ui/OnboardingActivity.kt`
- `res/layout/activity_onboarding.xml` (3 cards in a `ViewPager2`)
- `permissions/PermissionGate.kt`

**Implementation:** ViewPager2 with 3 fragments; each has a brief
explanation, an action button. Bottom progress indicator. Last card's
button finishes onboarding and starts service + WebView.

**Acceptance:** activity opens, swipes through 3 cards, finishes to
WebViewActivity.

**Commit:** `feat(android): add OnboardingActivity scaffold`

---

### T6.2 — Card 1: location permission

**Depends on:** T6.1

**Files:** Card 1 fragment, `PermissionGate.kt`

**Implementation:**
- Request `ACCESS_FINE_LOCATION` + `ACCESS_COARSE_LOCATION` first.
- Then on Android 10+ (API 29+), request `ACCESS_BACKGROUND_LOCATION`
  in a separate flow as required by Android.
- On Android 13+, also request `POST_NOTIFICATIONS`.
- Card text: "Reyy EV needs location access to keep your scooter visible
  to operations." (Honest, doesn't get into specifics of upload.)
- If denied, the button text changes to "Open Settings" and intents to
  app details.

**Acceptance:** all three (fine, background, notifications) are granted
after running through the card on a real Android 14 device. Confirmed by
`adb shell dumpsys package in.reyyev.driver | grep granted`.

**Commit:** `feat(android): add location permission onboarding card`

---

### T6.3 — Card 2: battery optimization

**Depends on:** T6.1

**Implementation:**
- Check `PowerManager.isIgnoringBatteryOptimizations(packageName)`.
- If false, button fires `Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)`
  with `data = Uri.parse("package:$packageName")`.
- Card text: "Disable battery optimization for Reyy EV so it can stay
  connected even when your screen is off."

**Acceptance:** after action, `isIgnoringBatteryOptimizations` returns true.

**Commit:** `feat(android): add battery optimization onboarding card`

---

### T6.4 — Card 3: OEM autostart deep-link

**Depends on:** T6.1

**Files:** `permissions/OemAutostart.kt`, Card 3 fragment

**Implementation:** per LLD §7.6.
- `OemAutostart.intentFor(): Intent?` returns the right intent based on
  `Build.MANUFACTURER` (case-insensitive). Returns null for unsupported
  OEMs.
- Card hides itself if `intentFor() == null` (unknown OEM, likely stock
  Android).
- Card text varies by OEM: Xiaomi → "Tap below and enable Autostart for
  Reyy EV in MIUI Security." Vivo → "...in iManager". Etc.
- Button fires the intent. We can't programmatically detect that the user
  toggled the switch, so the button label switches to "I've enabled it"
  after first tap.

**Acceptance:** on a Xiaomi device, the intent successfully launches the
Autostart screen with the app pre-listed.

**Commit:** `feat(android): add OEM autostart onboarding card`

---

### T6.5 — Onboarding completion gate

**Depends on:** T6.4

**Implementation:** finishing card 3 sets
`TokenStore.setOnboardingComplete()`, starts the foreground service, and
launches `WebViewActivity` with `FLAG_ACTIVITY_CLEAR_TASK`.

`LoginActivity` and `WebViewActivity` both check
`isOnboardingComplete()` on start; missing → bounce to
`OnboardingActivity`.

**Acceptance:** clean install → login → onboarding (3 cards) → home page.
Re-launch skips onboarding.

**Commit:** `feat(android): persist onboarding completion`

---

## Phase 7 — Polish and release

### T7.1 — App icon and notification icon

**Files:** `res/mipmap-*/ic_launcher.*`, `res/drawable/ic_notif.xml`

**Implementation:** simple Reyy EV mark. Notification icon is monochrome
white-on-transparent (Android 5+ requirement). Reuse existing brand
emerald accent from the website.

**Commit:** `chore(android): add app and notification icons`

---

### T7.2 — ProGuard/R8 rules

**Files:** `android/app/proguard-rules.pro`

**Implementation:** keep Moshi/Retrofit/OkHttp consumer rules (auto). Add
explicit `-keep class in.reyyev.driver.net.dto.** { *; }` for Moshi.

**Acceptance:** `./gradlew assembleRelease` succeeds; release APK installs;
login round-trip works (smoke).

**Commit:** `chore(android): add ProGuard rules for release build`

---

### T7.3 — Sentry integration (optional)

Skip if not wanted. Otherwise: add `io.sentry:sentry-android:7.x`,
configure DSN in BuildConfig, no breadcrumbs that contain PII. Out of v1
budget by default.

---

### T7.4 — On-device test matrix

**Files:** `docs/driver-app/TEST_MATRIX.md` (new)

**Implementation:** create a checklist for at least one device per:
- Stock Android (Pixel 6+ / Samsung Galaxy A-series)
- Xiaomi/Redmi (HyperOS / MIUI)
- Realme/Oppo (ColorOS)
- Vivo (Funtouch / OriginOS)
- Entry-level (Android Go on a sub-₹10k phone)

For each, run the v1 success criteria (HLD §11). Record pass/fail with
screenshots. This becomes the release gate.

**Acceptance:** all five devices pass.

**Commit:** `docs(android): add on-device test matrix`

---

### T7.5 — Signed release APK and installer guide

**Files:** keystore (offline only — never committed!),
`docs/driver-app/INSTALL_GUIDE.md` (new)

**Implementation:**
1. Generate a release keystore once: `keytool -genkey -v -keystore
   reyy-release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias reyy`.
2. **Back this up to two secure offline locations.** Losing it means no
   future updates to the same APK identity.
3. `signingConfigs` in `build.gradle.kts` reads from `~/.gradle/reyy.properties`
   (path also outside the repo).
4. Document the install flow for field installers:
   - Sideload the signed APK.
   - Toggle "Install unknown apps" for the installer's transfer method.
   - First launch: log in, run onboarding, verify the persistent
     notification appears.
   - Hand the phone to the driver.

**Acceptance:** signed release APK exists; installer guide is
self-explanatory enough for a non-engineer.

**Commit:** `docs(android): add release signing and install guide`

---

### T7.6 — Vercel custom domain (recommended)

Outside the repo's scope, but flag in the task list:
1. Buy a domain (e.g. `reyyev.in`).
2. Point a CNAME to your Vercel deployment.
3. Update `BuildConfig.API_BASE_URL` to the custom domain in the
   release build type.
4. Rebuild and re-sign the release APK.

**Why:** the Vercel-generated subdomain can change if you rename or move
the project. A custom domain is permanent. APKs are hard to update once
distributed; URLs they point to should be stable.

---

## Final acceptance — release gate

The driver app v1 is **shippable** when all of the following are true:

1. `npm run lint && npm run build` clean on `reyy-ev`.
2. `./gradlew assembleRelease` clean on `android/`.
3. Test matrix (T7.4) passes on at least 3 device classes.
4. End-to-end real-driver test: 24 hours of pings observed in DDB with
   gaps ≤ 5 minutes.
5. A pilot driver has used the app for at least 48 hours without complaint.
6. Operations can:
   - Set/reset a driver password from the dashboard.
   - See "last seen" on the customer detail page.
   - Identify a stale tracker within 10 minutes.

When all six are true, distribute the APK to the rest of the fleet.

---

## Per-task summary cheatsheet

| ID   | Title                                          | Depends on |
| ---- | ---------------------------------------------- | ---------- |
| T1.1 | Add npm deps                                   | —          |
| T1.2 | Document JWT_SECRET                            | —          |
| T1.3 | `src/lib/jwt.ts`                               | T1.1       |
| T1.4 | `src/lib/driverAuth.ts`                        | T1.1, T1.3 |
| T1.5 | `src/lib/driverHome.ts`                        | T1.4       |
| T1.6 | `src/lib/location.ts`                          | —          |
| T1.7 | `src/proxy.ts` matcher update                  | —          |
| T2.1 | `set-driver-password` route                    | T1.4, T1.7 |
| T2.2 | `/api/driver/login`                            | T1.3, T1.4 |
| T2.3 | `/api/driver/me`                               | T1.3, T1.5, T2.2 |
| T2.4 | `/api/driver/location`                         | T1.6, T2.3 |
| T2.5 | `/driver/auth` token handoff                   | T1.3, T1.7 |
| T2.6 | Rental close: delete LATEST                    | T2.4       |
| T2.7 | (opt) `/api/admin/locations`                   | T2.4       |
| T3.1 | `/driver` home page                            | T1.5, T2.5 |
| T3.2 | `/driver/logout`                               | T3.1       |
| T3.3 | Admin: set-driver-password UI                  | T2.1       |
| T3.4 | Admin: last-seen UI                            | T2.4       |
| T3.5 | (opt) Admin map page                           | T2.7       |
| T4.1 | Bootstrap Android project                      | —          |
| T4.2 | Android deps + BuildConfig                     | T4.1       |
| T4.3 | App, TokenStore, Logger                        | T4.2       |
| T4.4 | Retrofit DriverApi                             | T4.3       |
| T4.5 | LoginActivity                                  | T4.4, T2.2 |
| T4.6 | WebViewActivity                                | T4.5, T2.5, T3.1 |
| T5.1 | LocationForegroundService scaffold             | T4.6       |
| T5.2 | LocationAlarmReceiver / 60s loop               | T5.1, T2.4 |
| T5.3 | LocationWatchdogWorker                         | T5.2       |
| T5.4 | BootReceiver                                   | T5.1       |
| T5.5 | Immediate ping on app open                     | T5.2       |
| T5.6 | Logout flow                                    | T4.6, T5.1 |
| T6.1 | OnboardingActivity scaffold                    | T4.5       |
| T6.2 | Location permission card                       | T6.1       |
| T6.3 | Battery optimization card                      | T6.1       |
| T6.4 | OEM autostart card                             | T6.1       |
| T6.5 | Onboarding completion gate                     | T6.4       |
| T7.1 | Icons                                          | T4.1       |
| T7.2 | ProGuard rules                                 | T4.4       |
| T7.3 | (opt) Sentry                                   | T4.3       |
| T7.4 | Test matrix                                    | T6.5, T5.6 |
| T7.5 | Signed APK + installer guide                   | T7.2, T7.4 |
| T7.6 | (opt) Custom domain switch                     | T7.5       |

Total: **40 tasks** (8 optional). Real engineering size: 3–4 focused days
plus 1 day of OEM device testing.
