# 02 — High-Level Design

## 1. Goals

- Give every active rental driver a phone app that:
  - Lets them log in with phone + password.
  - Shows their scooter, weekly rent, deposit, payment due, days left.
  - Continuously reports phone location to the backend, surviving OS kills.
- Reuse the existing `reyy-ev` Next.js app for **all** server logic and UI
  rendering. The Android side is a thin native shell hosting a WebView.
- Hot-update the UI by deploying to Vercel — APK redistribution only when
  native code (auth shell, location service, permissions) changes.
- **Zero new infrastructure.** No new database, no new hosting tier, no SMS
  provider, no Firebase project at v1. Marginal cost = a few thousand DDB
  writes per day.

## 2. Non-goals (v1)

- On-demand "fetch live location" via FCM silent push — deferred. The
  1-minute push to DDB is sufficient for the foreseeable use case. FCM can
  be bolted on in a follow-up release with no schema change.
- A map UI on the dashboard. Numeric latitude/longitude on the dashboard is
  enough at v1; an admin map view (Leaflet + OpenStreetMap, free) is
  earmarked for v1.1.
- Location history. We keep one "latest" row per active rental. Old
  positions are overwritten. If we later want history, we add a TTL'd row
  type `LOCATION#<rentalId>#<isoTs>` without breaking anything.
- Push notifications, in-app chat, payment intake from the app. All can be
  added later as new `/driver/*` Next.js pages with no native changes.
- iOS. Out of scope. The driver fleet is Android-only per requirements.

## 3. Topology

```
┌──────────────────────────────────────────────────────────────────────┐
│                       Driver's Android phone                          │
│                                                                       │
│  ┌─────────────────────────┐      ┌──────────────────────────────┐  │
│  │  Native shell (Kotlin)  │      │  WebView                      │  │
│  │                         │      │                               │  │
│  │  Activities (3):        │      │  Loads:                       │  │
│  │  • Login                │      │  https://<vercel>/driver      │  │
│  │  • Onboarding (perms)   │◄────►│  with Authorization: Bearer   │  │
│  │  • WebView host         │      │  <JWT>                        │  │
│  │                         │      │                               │  │
│  │  Background components: │      │  All UI/business logic for    │  │
│  │  • LocationFGService    │      │  the driver lives here and is │  │
│  │  • LocationWatchdog     │      │  hot-deployed via Vercel.     │  │
│  │  • LocationAlarm        │      │                               │  │
│  │  • BootReceiver         │      │                               │  │
│  └────────────┬────────────┘      └──────────────┬───────────────┘  │
│               │ HTTPS + JWT                       │ HTTPS + JWT       │
└───────────────┼───────────────────────────────────┼─────────────────-─┘
                │                                   │
                └──────────────┬────────────────────┘
                               ▼
        ┌────────────────────────────────────────────┐
        │  reyy-ev on Vercel  (single deployment)    │
        │  ── Existing dashboard ────────────────    │
        │     /, /customers, /rentals, /accounts,    │
        │     /api/* (gated by SITE_PASSWORD)        │
        │  ── New driver surface ────────────────    │
        │     /driver, /driver/...    (JWT)          │
        │     /api/driver/login                      │
        │     /api/driver/me                         │
        │     /api/driver/location                   │
        │  ── New admin surface ─────────────────    │
        │     /api/admin/customers/[id]/             │
        │       set-driver-password                  │
        │  ── Server-side secrets (Vercel env) ──    │
        │     AWS_ACCESS_KEY_ID, AWS_SECRET_…,       │
        │     SITE_PASSWORD, JWT_SECRET, S3_BUCKET   │
        └────────────────────┬───────────────────────┘
                             ▼
                     DynamoDB ReyyEV
                       (existing table,
                        new row types added)
```

## 4. Components

| Component | Tech | Owner | Notes |
| --- | --- | --- | --- |
| Native login activity | Kotlin / AppCompat | Android | phone + password, hits `/api/driver/login` |
| Permissions onboarding | Kotlin / AppCompat | Android | location, battery opt, OEM autostart |
| WebView host | Kotlin / WebView | Android | renders `/driver`, injects JWT |
| Location foreground service | Kotlin / FLP | Android | 60s push, sticky, persistent notif |
| Resilience layer | WorkManager + AlarmManager + BootReceiver | Android | revives killed service |
| Driver auth lib | TypeScript / `bcryptjs` + `jose` | Backend | `src/lib/jwt.ts`, `src/lib/driverAuth.ts` |
| Driver API routes | Next.js route handlers | Backend | `/api/driver/*` |
| Driver pages | Next.js + React | Backend | `/driver`, `/driver/login` (optional) |
| Admin password UI | Next.js + React | Backend | section in customer detail page |
| Schema additions | DynamoDB | Backend | `driverPasswordHash`, `PHONE#`, `LOCATION#…#LATEST` |

## 5. Major flows

### 5.1 Onboarding a new driver (admin operator)

```
Operator → Dashboard /customers/<id>
         → "Set driver password" button
         → enters password (or lets system generate)
         → POST /api/admin/customers/[id]/set-driver-password { password }
         → server: bcrypt(password) → updates customer profile
                   ensures PHONE#<digits> uniqueness row exists
                   responds { ok: true, password } (echoes if generated)
         → operator notes phone + password, hands to driver in person
         → operator installs APK on driver's phone, logs in for them,
           grants the 3 permissions, returns the phone
```

### 5.2 Driver login

```
Driver opens app → LoginActivity
       → enters phone + password
       → POST /api/driver/login { phone, password }
       → server normalises phone (+91 prefix), looks up PHONE#<digits>,
         finds CUSTOMER#<cid>, verifies bcrypt, signs JWT (90 days, HS256)
       → response { token, customer_id, customer_name }
       → app stores JWT in EncryptedSharedPreferences
       → app launches WebViewActivity, loads /driver
```

### 5.3 Location push (every 60s, while service is alive)

```
LocationForegroundService onCreate
   → startForeground(persistentNotif)
   → schedule LocationAlarmReceiver every 60s (setExactAndAllowWhileIdle)

LocationAlarmReceiver onReceive
   → acquire PARTIAL_WAKE_LOCK (timeout 10s)
   → fusedLocationClient.lastLocation OR getCurrentLocation
   → POST /api/driver/location { lat, lng, battery, captured_at }
   → server: upsert LOCATION#<rentalId>#LATEST under driver's customer
   → release wakelock
   → schedule next alarm in 60s
```

### 5.4 Home page render

```
WebView loads /driver
   → server-side: read JWT from header, derive customer_id
   → fetch active rental + balances (existing computeRentalBalances)
   → render: scooter label, weekly rent, deposit collected/pending,
             rent paid through, days left, contact action
   → WebView shows it; driver can scroll, refresh, tap "call ops"
```

### 5.5 Service revival paths

```
Path A — system memory pressure kills service
   → onStartCommand returned START_STICKY → system relaunches it
   → onCreate again → resumes alarm schedule

Path B — user swipes app from recents (process killed)
   → AlarmManager next alarm fires
   → BroadcastReceiver wakes app
   → starts service via startForegroundService()

Path C — device reboot
   → BootReceiver receives BOOT_COMPLETED
   → starts service

Path D — APK update
   → MY_PACKAGE_REPLACED → BootReceiver starts service

Path E — WorkManager periodic check (every 15 min)
   → if service not running, start it

Path F — operator notices stale location (>10 min) on dashboard
   → calls driver, asks them to re-open the app
```

## 6. Hot-update boundary

| Lives in APK (rebuild & redistribute to change) | Lives on Vercel (deploy → live on next app open) |
| --- | --- |
| Login screen UI | Home page UI |
| Permission prompts | Any new screens (history, receipts, support…) |
| Foreground service code | Backend logic, validation, billing math |
| Location upload payload format | Dashboard |
| API base URL (`BuildConfig`) | API responses (additive changes only) |
| Authorization scheme | Notification copy *content* (notification *type* is native) |

**Rule of thumb:** anything that *could* be a webpage *should* be a
webpage. The native shell is a permission scaffold + a daemon, nothing more.

## 7. Cost model

| Line item | Estimated monthly cost |
| --- | --- |
| Vercel hosting (Hobby tier) | ₹0 |
| DynamoDB writes (50 active rentals × 1440/day × 30 = 2.16M writes/mo) | ~₹150–250 |
| DynamoDB reads (home page, dashboard) | <₹50 |
| DynamoDB storage (one LATEST row per rental) | negligible |
| FCM | not used at v1 |
| SMS | not used (no OTP) |
| Firebase | not used |
| Maps SDK | not used (numeric coords; Leaflet free if needed later) |
| **Total marginal cost** | **~₹200–300/month at 50 rentals** |

This scales linearly with active rentals. At 500 active rentals, expect
~₹2000–3000/month. Still well under any meaningful threshold.

## 8. Privacy and legal posture

- **Disclosure:** rental agreement (already in place) discloses GPS
  tracking on both the scooter unit and any provided app. Consent is
  recorded at onboarding via signed paperwork. This satisfies DPDPA
  consent requirements and the SPDI Rules.
- **Data minimisation:** we store *only* the latest position per active
  rental. We do not store history at v1. Location is purged the moment a
  rental closes (handled in the rental-close path — see LLD §3.5).
- **Notification copy:** intentionally non-descriptive ("Reyy EV — Connected. Tap to open."). The
  app does not actively highlight tracking; the user has consented in
  writing and the system surfaces it via standard Android indicators.
- **Access controls:** location data is readable only by the dashboard
  (site-password gated). A driver's JWT does not authorize reading any
  location, only writing their own.

## 9. Out of scope (call-outs)

- iOS app
- Driver-initiated payment from the app
- Driver-to-ops chat
- Push notifications to the driver
- Live ride-share / multi-stop optimisation
- Vehicle telemetry (scooter has its own GPS unit on a separate channel)
- Offline mode (location uploads always go online; we do not buffer when
  offline at v1, the next minute's tick replaces the missed one)

## 10. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| OEM aggressive kill (Xiaomi, Vivo) | High | Tracker silently dies | OEM autostart deep-link in onboarding; server-side stale-tracker alert |
| User force-stops the app | Low | Tracker fully dead until reopen | Server-side stale alert; rental agreement clause |
| JWT leak from device | Low | Single driver's data exposed | Tokens scoped to one customer; rotate `JWT_SECRET` to invalidate fleet-wide |
| Vercel free-tier limits hit | Low | API throttled | Move to Pro (₹1700/mo) — large headroom under driver-app load |
| DDB hot partition on `GSI1PK=LOCATIONS` | Low | Throttled writes | At <500 RCU/WCU per second this is not a real concern; if hit, switch GSI partition strategy |
| Vercel domain change post-launch | Medium | Old APKs broken | Buy custom domain, point at Vercel; APK references custom domain |
| Driver uninstalls app | Low | Tracker dead | Server-side stale alert; agreement clause; supplemented by scooter's own GPS |

## 11. Success criteria for v1

1. Operator can set a driver password from the dashboard in under 30s.
2. Driver can log in and see their home page within 5s of opening the app.
3. Latest location appears in DDB within 90s of every minute on a stock
   Pixel/Samsung phone with battery optimization disabled.
4. Service survives: Recents-swipe, screen off for 1 hour, device reboot,
   APK update, low-battery state.
5. Acceptable behaviour on Xiaomi/Realme after the OEM autostart toggle is
   enabled (verified manually on at least one such device pre-release).
6. Total monthly cost increase under ₹500 at the current rental count.
