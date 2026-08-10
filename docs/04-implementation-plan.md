# 04 — Implementation Plan

This is the build order. Phases run **sequentially**; tasks within a phase
can run in parallel where they don't share files. Each phase has explicit
exit criteria — do not move to the next phase until they are met.

Total estimated effort: **3–4 focused engineering days**, plus 1 day of
device testing and OEM verification.

---

## Phase 1 — Backend foundation

**Goal:** drop the building blocks for driver auth into `reyy-ev` without
shipping any user-visible behaviour.

| # | Work | Notes |
| --- | --- | --- |
| 1.1 | Add npm deps: `bcryptjs@^2`, `@types/bcryptjs`, `jose@^5` | Already widely used; no native deps |
| 1.2 | Add `JWT_SECRET` to Vercel env vars (and `.env.example`) | Generate with `openssl rand -base64 48` |
| 1.3 | Create `src/lib/jwt.ts` — sign / verify helpers using `jose` | See LLD §4.1 |
| 1.4 | Create `src/lib/driverAuth.ts` — phone normaliser, lookup, bcrypt verify, password set | See LLD §4.2 |
| 1.5 | Create `src/lib/driverHome.ts` — payload builder | Reuses `computeRentalBalances` |
| 1.6 | Create `src/lib/location.ts` — types, validator, upserter | See LLD §4.4 |
| 1.7 | Update `src/proxy.ts` matcher — exclude `/api/driver/*` and `/driver/*` | One-line change |

**Exit criteria:**
- `npm run build` clean.
- `npm run lint` clean.
- `JWT_SECRET` set on Vercel preview & production.
- Unit-style smoke test via a temporary `/api/admin/_smoke` route (deleted
  after) that calls `signDriverJwt` then `verifyDriverJwt` and returns
  `{ ok: true }`.

---

## Phase 2 — Backend driver routes

**Goal:** all four new HTTP endpoints live and verifiable via curl on
Vercel.

| # | Work | Notes |
| --- | --- | --- |
| 2.1 | `POST /api/admin/customers/[id]/set-driver-password` | Site-password gated |
| 2.2 | `POST /api/driver/login` | Includes constant-time fallback when phone unknown |
| 2.3 | `GET /api/driver/me` | JWT-auth |
| 2.4 | `POST /api/driver/location` | JWT-auth, validates ping, upserts LATEST |
| 2.5 | `GET /driver/auth?token=...` Next.js page | Sets `reyy_driver` cookie, redirects to `/driver` |
| 2.6 | Rental close path: best-effort delete of `LOCATION#<rid>#LATEST` | In existing rental-close handler(s) |
| 2.7 | (Optional, can defer) `GET /api/admin/locations` | For future map view |

**Exit criteria:** end-to-end curl flow works against the Vercel deployment:

```bash
# 1. Set a password (admin)
curl -X POST https://<vercel>/api/admin/customers/<cid>/set-driver-password \
  -H "Content-Type: application/json" \
  -H "Cookie: reyy_auth=<hash>" \
  -d '{"generate": true}'
# → { ok: true, password: "Ab3kQp9z" }

# 2. Driver login
curl -X POST https://<vercel>/api/driver/login \
  -H "Content-Type: application/json" \
  -d '{"phone":"9876543210","password":"Ab3kQp9z"}'
# → { token: "eyJ...", customer_id: "...", customer_name: "..." }

# 3. Home page
curl https://<vercel>/api/driver/me \
  -H "Authorization: Bearer eyJ..."
# → full driver home payload

# 4. Location push
curl -X POST https://<vercel>/api/driver/location \
  -H "Authorization: Bearer eyJ..." \
  -H "Content-Type: application/json" \
  -d '{"lat":28.6,"lng":77.2,"battery":80,"captured_at":"2026-06-14T12:00:00Z"}'
# → 204 No Content
```

After running these, inspect DDB to confirm the `LOCATION#<rid>#LATEST` row
exists with the expected attributes.

---

## Phase 3 — Dashboard surfaces

**Goal:** operators can do everything they need from the dashboard, and the
WebView page renders cleanly.

| # | Work | Notes |
| --- | --- | --- |
| 3.1 | `/driver` page — server component, reads cookie, renders home | LLD §5.1 |
| 3.2 | `/driver/auth` page — token → cookie → redirect | LLD §5.2 |
| 3.3 | Dashboard customer detail: "Driver login" section with `Set / Reset password` | Wire to `/api/admin/customers/[id]/set-driver-password` |
| 3.4 | Dashboard customer detail: show "Last seen" if `LOCATION#…#LATEST` exists | Optional, low effort |
| 3.5 | (Optional, can defer) Dashboard map page using Leaflet | Use OSM tiles, free |

**Exit criteria:**
- Operator can set/reset a driver password from the dashboard.
- Visiting `/driver/auth?token=<valid>` in a browser (with the JWT pasted
  from Phase 2 step 2) redirects to `/driver` and shows a coherent page
  with the customer's data.
- Visiting `/driver` directly without the cookie redirects to the login
  page (which does **not** exist as a Next.js page — the JS shell handles
  login natively; the redirect target is a small `/driver/expired` page or
  a JSON `401` for the WebView to detect and bounce out to native login).

---

## Phase 4 — Android shell (login + WebView)

**Goal:** an APK that lets a driver log in and see the home page. No
location service yet.

| # | Work | Notes |
| --- | --- | --- |
| 4.1 | Bootstrap Android project (Kotlin, AGP 8.x, minSdk 26, targetSdk 34) | Fresh `android/` dir at the workspace root |
| 4.2 | Configure `BuildConfig.API_BASE_URL` per build type | LLD §10 |
| 4.3 | `ReyyApp` Application class; init `TokenStore`, OkHttp/Retrofit | |
| 4.4 | `LoginActivity` — phone, password, button, error display | |
| 4.5 | `WebViewActivity` — loads `/driver/auth?token=` | |
| 4.6 | Routing: app start → if `TokenStore.get() != null` → `WebViewActivity`, else `LoginActivity` | |
| 4.7 | Hardware back button: in WebView, navigates back if possible, else exits | |

**Exit criteria:**
- APK installs on a real device.
- Login with the phone+password from Phase 2 step 1 succeeds.
- WebView shows `/driver` home page populated with the right driver's data.
- Re-launching the app skips login and goes straight to the WebView.
- Tapping a logout button in the WebView (calls `window.location='/driver/logout'`
  which clears the cookie + a JS bridge `Android.logout()` clears
  `TokenStore` → re-launch goes to login).

---

## Phase 5 — Foreground service + resilience

**Goal:** location is pushed every minute and survives the kill paths
listed in HLD §5.5.

| # | Work | Notes |
| --- | --- | --- |
| 5.1 | `LocationForegroundService`, manifest entry with `:location` process | LLD §7.4 |
| 5.2 | `LocationAlarmReceiver` — 60s `setExactAndAllowWhileIdle`, self-reschedules | LLD §7.5 |
| 5.3 | `LocationWatchdogWorker` — periodic 15-min check, restart if dead | |
| 5.4 | `BootReceiver` — boot/locked-boot/package-replaced → start service | |
| 5.5 | Notification channel + `NotificationCompat.Builder` with neutral copy | LLD §7.4 |
| 5.6 | `WebViewActivity.onResume` triggers an immediate location push | "Send location on app open" requirement |
| 5.7 | Wakelock acquisition with timeout in receiver | |
| 5.8 | Retrofit `AuthInterceptor` injects `Authorization: Bearer <jwt>` on every call | |

**Exit criteria** (verified on a stock Pixel/Samsung with battery
optimization disabled):
- Service starts and stays alive after launching the app.
- DDB `LOCATION#<rid>#LATEST` row updates within 90s of every minute,
  watched for 1 hour.
- Force-killing the app from Recents: alarm next fires → service revives →
  ping continues. Confirm in DDB.
- Powering the device off and back on: service revives within 60s of unlock.
- Reinstalling the APK over the previous version: service revives.

---

## Phase 6 — Permissions onboarding

**Goal:** first-launch flow walks the driver through every permission
toggle so the field installer doesn't have to remember each step.

| # | Work | Notes |
| --- | --- | --- |
| 6.1 | `OnboardingActivity` with three sequential cards | LLD §7.2 |
| 6.2 | Card 1: location (fine + background, separate dialogs on Android 10+) | |
| 6.3 | Card 2: battery optimization whitelist | `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` |
| 6.4 | Card 3: OEM autostart deep-link | LLD §7.6, with manufacturer detection |
| 6.5 | Mark onboarding complete in `TokenStore` after card 3 | Skipped on subsequent runs |
| 6.6 | Re-run prompt if `WebViewActivity` detects stale ping (no response from `/api/driver/me?check_recent_ping=true` — server-supplied flag) | Optional, can defer |

**Exit criteria:**
- Fresh install on a Xiaomi/Realme device walks through all three cards.
- After the flow, location pushes work for at least 8 hours of normal use
  (screen off, phone in pocket).
- Skipping any card disables the corresponding feature gracefully — service
  still tries, but doesn't crash.

---

## Phase 7 — Polish, OEM testing, release

| # | Work | Notes |
| --- | --- | --- |
| 7.1 | App icon, launcher label, neutral notification icon (white-on-transparent) | |
| 7.2 | R8/ProGuard rules for OkHttp/Retrofit/Moshi | Use shipped consumer rules |
| 7.3 | Crash reporting | Optional. If wanted, add Sentry (free tier), no Firebase. |
| 7.4 | Manual test matrix on at least: 1 Pixel, 1 Samsung, 1 Xiaomi/Realme/Vivo, 1 entry-level (Android Go) | |
| 7.5 | Build signed release APK with a stable keystore stored offline | Keep keystore safe — losing it means no future updates |
| 7.6 | Document install steps for field installers (set "Unknown sources" → install → log in → onboarding) | |
| 7.7 | Document Vercel custom domain (recommended) so the APK URL is durable | |

**Exit criteria:**
- Release APK signed.
- Test matrix passed (location pushed continuously for 8h on each device).
- Internal sign-off from operations.

---

## Risk register

| Risk | Phase | Mitigation in plan |
| --- | --- | --- |
| Vercel cookie + HttpOnly issue across subdomains | 3 | Use the same Vercel domain for both dashboard and driver; no subdomain split needed |
| `bcryptjs` slow on Vercel cold start | 1 | Cost factor 10 is fine; cold starts ~250ms one-off |
| OEM autostart intent fails to resolve | 6 | Code falls through to "skipped" and surfaces a manual link to settings |
| `setExactAndAllowWhileIdle` rate-limited under Doze | 5 | Combined with WorkManager fallback, this is acceptable; in Doze, at worst we get one ping per Doze maintenance window (~15 min) |
| Foreground service type missing on Android 14+ | 5 | `foregroundServiceType="location"` set; manifest reviewed |
| User force-stops the app | — | Server-side stale alarm; rental agreement clause; outside our control |
| Vercel domain change post-launch | 7 | Recommend custom domain in 7.7 |
| Hidden-by-OEM "deep sleep" mode (Samsung, Vivo) | 7 | Document in installer guide; require operator to remove app from sleep list during install |

---

## Test strategy

**Backend:**
- Per-route curl checklist (see Phase 2 exit criteria).
- DDB inspection after each curl, via `aws dynamodb get-item` or the AWS console.

**Android:**
- On-device manual checklist per Phase 5/6 exit criteria.
- One instrumented test for the foreground-service revival path,
  using `UiAutomator` to invoke `am force-stop` then asserting the
  service is back within 90s. Owned by Phase 5 task list.

**End-to-end (release gate):**
- Onboard a real test driver on a real test device.
- Watch DDB for 24 hours. Expected: ~1440 LATEST updates over 24h with
  gaps ≤ 5 minutes.
- Confirm dashboard "last seen" timestamp tracks within ~60–90s.

---

## Rollout

1. Ship Phase 1–3 to Vercel **without** breaking dashboard (no UI removed,
   only added). The driver routes are dormant until a driver password is
   set.
2. Build APK with **staging** `API_BASE_URL` pointing at a Vercel preview
   deployment. Test internally for 24h.
3. Cut a production APK pointing at the production Vercel deployment.
4. Distribute to one pilot driver. Watch for 48h.
5. Distribute to the rest of the fleet.

There is no "v0.5" — the v1 cut is the entire stack. But because the
dashboard surfaces are additive, the backend can be deployed safely well
ahead of any APK distribution.

---

## What's intentionally not in this plan

- **CI/CD for Android.** Building APK on push is nice-to-have, not v1. A
  local `./gradlew assembleRelease` is fine for a fleet of dozens of
  drivers.
- **Crash reporting.** Sentry is optional in Phase 7.3. Skip if budget-
  conscious; reach for it if reports of "the app stopped working" become
  hard to triage.
- **Test runner for the backend.** Listed as deferred in the coding spec.
- **iOS, FCM, in-app payments, chat.** All explicitly out of scope; see HLD
  §2.
