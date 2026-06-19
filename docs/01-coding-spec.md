# 01 — Coding Specification

This document is the binding style guide for the Reyy EV driver-app effort. It
covers both the **backend changes** to `reyy-ev` (TypeScript + Next.js) and the
**new native Android shell** (Kotlin). Every task in `05-tasks-antigravity.md`
must satisfy these rules; if a rule conflicts with an existing pattern in
`reyy-ev`, the existing pattern wins (we conform to the codebase, not the
other way around).

---

## 1. Universal principles

1. **Match the host codebase.** Read the surrounding file before adding to it.
   `reyy-ev` already has a strong, consistent voice — terse code, generous
   explanatory comments, single-purpose files in `src/lib/`. Continue that
   voice.
2. **SOLID, but not ceremonial.** Single-responsibility per file/class is the
   only one we enforce explicitly. We do not add interfaces for things with
   one implementation.
3. **Smallest possible change.** A bug fix does not become a refactor. A
   feature does not pull in unused abstractions.
4. **Production-grade by default.** No `console.log` debug statements left in,
   no `TODO` / `FIXME` without a tracked task ID, no swallowed exceptions.
5. **Comment the *why*, not the *what*.** Code shows *what*. Comments must
   add information the code can't carry — design rationale, business rule,
   trade-off, link to a constraint. The existing `reyy-ev` code is the
   reference (see `src/lib/billing.ts`, `src/lib/leads.ts`, `src/proxy.ts`).
6. **No new dependencies without justification.** Every added package must
   be (a) actively maintained, (b) sized appropriately for the problem,
   (c) noted in the task description with a one-line reason.

---

## 2. Backend — TypeScript / Next.js

### 2.1 File organization

| Concern | Location |
| --- | --- |
| Pure types, validators, math | `src/lib/<concern>.ts` (no AWS imports — must be safe to import from client components) |
| AWS-touching helpers | `src/lib/<concern>.ts` (with `import "server-only"` if we need to enforce) |
| Driver auth + JWT | `src/lib/jwt.ts`, `src/lib/driverAuth.ts` |
| Location upsert helper | `src/lib/location.ts` |
| API routes | `src/app/api/<area>/route.ts` (or `[id]/route.ts`) |
| Driver-facing pages (WebView targets) | `src/app/driver/<page>/page.tsx` |

**One concern per file.** If `driverAuth.ts` starts touching DDB writes
unrelated to auth, that work goes to a new file.

### 2.2 Naming

- **Files:** `kebab-case.ts` for libs, `route.ts` / `page.tsx` per Next.js.
- **TypeScript symbols:**
  - `camelCase` for variables, functions.
  - `PascalCase` for types, interfaces, classes, enum-likes.
  - `SCREAMING_SNAKE_CASE` for module-level constants only when truly
    constant (e.g. `LEDGER_KINDS`).
- **HTTP JSON payloads:** `snake_case` (matches existing API surface —
  see `customer_id`, `start_date`, `rate_unit`).
- **DynamoDB attributes:** `camelCase` (matches existing items — see
  `customerName`, `startDate`).
- The route handler is the boundary that translates between the two.

### 2.3 Comments

- Every non-trivial file starts with a block comment explaining its role
  and any non-obvious design choice. **Pattern:**

  ```ts
  // Driver authentication: phone + password → JWT.
  //
  // Drivers are existing CUSTOMER#<id> rows; an admin sets
  // `driverPasswordHash` (bcrypt) on the profile during onboarding. Login
  // looks up the customer by phone via the PHONE# uniqueness row, verifies
  // the bcrypt hash, and issues a 90-day HS256 JWT signed with JWT_SECRET.
  ```

- Inline comments above tricky lines, not at end-of-line.
- Never restate the code in English. `// increment counter` above `i++`
  is forbidden. Add a comment only when the code's intent or invariant
  isn't obvious.

### 2.4 Types and interfaces

- `interface` for object shapes (matches existing convention).
- `type` for unions, intersections, mapped types, primitives.
- `as const` for tuple-of-options patterns (see `LEDGER_KINDS`,
  `ID_TYPES`).
- Type predicates for runtime validators:
  ```ts
  export function isValidPhone(s: unknown): s is string { ... }
  ```
- Avoid `any`. Use `unknown` and narrow.
- Public types exported from `src/lib/` are part of the contract — change
  them deliberately and update callers in the same commit.

### 2.5 Validation and error handling

- Every route handler validates inputs at the top and short-circuits with
  `NextResponse.json({ error: "..." }, { status: 400 })` on failure.
- Error messages are short, lowercase, no trailing punctuation, no PII.
- Status codes:
  - `400` malformed input
  - `401` missing/invalid auth
  - `403` valid auth, wrong subject (e.g. driver A trying to access driver B)
  - `404` resource not found
  - `409` uniqueness conflict (e.g. duplicate phone on signup)
  - `422` semantically invalid (e.g. trying to log location on a closed rental)
  - `500` reserved for genuine server errors; log details server-side, return
    a generic `{ error: "internal error" }` body
- Never `console.log` PII. Phone numbers, location coordinates, names — none
  of those go to logs in production.

### 2.6 Imports

- Use the `@/` path alias (already configured in `tsconfig.json`).
- Group order: node/runtime, third-party, `@/lib`, relative.
- One import per line. No `import * as`.

### 2.7 Tooling

- ESLint config already at `eslint.config.mjs`. CI passes lint cleanly.
- `npm run lint` must be clean before any commit.
- No new Prettier config; defer to the existing setup.

---

## 3. DynamoDB conventions

### 3.1 Single-table model

We extend the existing `ReyyEV` table. **No new tables.** Three patterns
documented in `README.md` apply:
- Items related to a customer share `PK = CUSTOMER#<cid>` and differ by `SK`
  prefix (`PROFILE`, `PHOTO#`, `RENTAL#`, `PAYMENT#`, `DEPOSIT#`).
- `GSI1PK = "CUSTOMERS" / "RENTALS"` for global lists.
- Uniqueness markers under their own PK (e.g. `RENTALID#<id>`).

Driver-app additions follow the same patterns:
- `LOCATION#<rentalId>#LATEST` lives under the customer's PK.
- `PHONE#<digits>` is a uniqueness marker, like `RENTALID#`.
- `LOCATIONS` joins the global list set.

### 3.2 Item shape

- All writes use `PutCommand` / `UpdateCommand` from
  `@aws-sdk/lib-dynamodb`, never the raw `DynamoDBClient` for items.
- `removeUndefinedValues: true` is already enabled — write `undefined` for
  optional fields, do not write `null` unless the field is semantically
  nullable on read.
- Denormalise sparingly: copy `customerName` onto rentals (already done) so
  the listing endpoint doesn't fan out, but never copy something that can
  change without updating both copies.
- `createdAt` is always ISO 8601 UTC (`new Date().toISOString()`).

### 3.3 Transactions

- Use `TransactWriteCommand` whenever a write touches more than one item and
  the items must be consistent (e.g. customer profile + phone uniqueness
  marker, rental + rentalId uniqueness marker).
- Existing `src/app/api/rentals/route.ts` is the reference example.

---

## 4. API design

### 4.1 Conventions

- One route handler per HTTP method per file; export `GET`, `POST`, etc.
- Route handlers are thin: validate → delegate to `src/lib/` helper →
  return JSON. Business logic does not live in the handler.
- Responses always JSON, even for empty success: `{ ok: true }`.
- No GraphQL, no tRPC. Plain REST, snake_case, mirrors the existing routes.

### 4.2 Auth boundary

| Route prefix | Auth |
| --- | --- |
| `/api/login`, `/login` | none (public; sets the site cookie) |
| `/api/driver/login` | none (public; sets the JWT) |
| `/api/driver/*` (other) | JWT bearer token |
| `/api/admin/*` | site password cookie (via `proxy.ts`) |
| `/api/*` (existing) | site password cookie (existing behaviour, unchanged) |
| `/driver/*` pages | JWT (cookie or header) |
| `/*` pages (dashboard) | site password cookie |

The `proxy.ts` matcher must be updated to **exclude `/api/driver/*` and
`/driver/*`** from the site-password gate. Driver auth is handled inside the
route handlers, not at the proxy.

---

## 5. Android — Kotlin

### 5.1 Project structure

```
android/
├── app/
│   ├── build.gradle.kts
│   ├── src/main/
│   │   ├── AndroidManifest.xml
│   │   ├── java/in/reyyev/driver/
│   │   │   ├── ReyyApp.kt                  # Application class
│   │   │   ├── ui/
│   │   │   │   ├── LoginActivity.kt
│   │   │   │   ├── OnboardingActivity.kt
│   │   │   │   └── WebViewActivity.kt
│   │   │   ├── service/
│   │   │   │   ├── LocationForegroundService.kt
│   │   │   │   ├── LocationWatchdogWorker.kt
│   │   │   │   ├── LocationAlarmReceiver.kt
│   │   │   │   └── BootReceiver.kt
│   │   │   ├── net/
│   │   │   │   ├── ApiClient.kt
│   │   │   │   ├── DriverApi.kt            # Retrofit/OkHttp service
│   │   │   │   └── TokenStore.kt
│   │   │   ├── permissions/
│   │   │   │   ├── PermissionGate.kt
│   │   │   │   └── OemAutostart.kt
│   │   │   └── util/
│   │   │       ├── Logger.kt               # wraps Log.* with no-PII enforcement
│   │   │       └── Constants.kt
│   │   └── res/...
│   └── build/...
├── gradle/
└── build.gradle.kts
```

### 5.2 Naming

- **Packages:** `in.reyyev.driver.<area>` (using the `.in` ccTLD reverses
  to `in.reyyev`).
- **Files:** `PascalCase.kt`, one top-level class/object per file.
- **Symbols:**
  - `camelCase` for properties, functions, locals.
  - `PascalCase` for classes, objects, interfaces, sealed classes.
  - `SCREAMING_SNAKE_CASE` for top-level `const val`.
- **Resources:**
  - Strings: `snake_case`, prefixed by screen (e.g. `login_phone_hint`).
  - IDs: `snake_case`, prefixed by type (`btn_`, `et_`, `tv_`).

### 5.3 Concurrency

- Coroutines only. No `AsyncTask`, no `RxJava`, no raw `Thread`.
- Service work uses `serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)`.
- Network calls are `suspend` and execute on `Dispatchers.IO`.
- UI work on `Dispatchers.Main`.
- All scopes cancelled in `onDestroy` / lifecycle terminus.

### 5.4 Logging

- All logs go through `util/Logger.kt`. Direct `android.util.Log` is
  **forbidden** in non-Logger code.
- `Logger` strips known PII fields: `phone`, `password`, `lat`, `lng`,
  `token`. Replaced with `***`.
- `BuildConfig.DEBUG` gates verbose logs; release builds emit `WARN`+ only.

### 5.5 Resource management

- Use `AndroidX` libraries throughout (no support library).
- Lifecycle-aware components: bind to `LifecycleScope` where applicable.
- WakeLocks acquired with a timeout (`acquire(10_000L)`); never indefinite.
- BroadcastReceivers registered in manifest where possible (survive process death).

### 5.6 Networking

- **OkHttp + Retrofit + Moshi.** Lightweight, standard, minimal codegen.
- Base URL from `BuildConfig.API_BASE_URL` (set per build type).
- Authorization header injected via an OkHttp `Interceptor` that reads from
  `TokenStore`.
- Timeouts: `connectTimeout = 10s`, `readTimeout = 10s`, `writeTimeout = 10s`.
- Retries: OkHttp default retries on connection failure are sufficient for
  location uploads. Application-layer retry only for the location worker:
  if a 5xx, retry once after 5s, then drop (next minute will try again).

### 5.7 Storage of secrets

- JWT goes in **`EncryptedSharedPreferences`** (AndroidX Security).
- Master key from Android Keystore, AES256-GCM.
- No JWT in plain SharedPreferences, no JWT in app private files.

### 5.8 Manifest hygiene

- `android:exported` set explicitly on every component.
- `android:allowBackup="false"` (we don't want JWT exfiltrated via auto-backup).
- `android:usesCleartextTraffic="false"` (HTTPS only — Vercel is HTTPS).

---

## 6. Security

1. **Server is the trust boundary.** No AWS keys, no DDB endpoints, no S3
   keys are ever embedded in the APK. The APK only knows
   `https://<vercel-domain>` and a per-user JWT.
2. **JWT is the only credential.** `JWT_SECRET` is a Vercel env var, never
   committed. Rotate by changing the env var (invalidates all tokens).
3. **bcrypt cost factor 10** for driver passwords. Standard Node `bcryptjs`.
4. **Phone numbers are normalised** to `+91XXXXXXXXXX` server-side before any
   DDB lookup or storage. The `PHONE#` row uses the normalised form.
5. **No location data reaches client browsers** other than the dashboard's
   admin map view. The driver's own JWT does not authorize them to fetch
   any location data, only to write their own.
6. **HTTPS only.** `usesCleartextTraffic="false"` enforces this on Android.
7. **Input length caps** on every string field server-side: phone ≤ 16,
   password ≤ 128, lat/lng numeric range checked.

---

## 7. Testing

`reyy-ev` does not currently use a test runner. We will not introduce one in
this effort — out of scope, would balloon the work. Verification strategy:

- **Backend:** manual `curl` exercises documented in `05-tasks-antigravity.md`
  per route. Each route handler has a "Acceptance: curl …" line.
- **Android:** manual on-device verification, with one instrumented test
  for the foreground service revival path (using `UiAutomator` to force-stop
  and confirm restart).
- **End-to-end:** a checklist in the implementation plan covers full
  driver onboarding → login → 1-min location push → dashboard sees latest.

If we later decide to add tests proper, the recommendation is `vitest` for
backend (already idiomatic with Next.js 16) and JUnit5 + Robolectric for
Android. Out of scope for v1.

---

## 8. Inclusive language

Per `amazon-builder-inclusivity-scanner.md` (which applies to all our work):
no `master/slave`, `whitelist/blacklist`. Use `primary/replica`,
`allowlist/denylist`. The existing `reyy-ev` code already complies.

---

## 9. What "done" means

A task in `05-tasks-antigravity.md` is **done** when:
1. Code compiles / lints clean.
2. The acceptance criterion in the task is demonstrably satisfied
   (curl output, screenshot, log line — whatever the task names).
3. A git commit exists with a Conventional Commits message.
4. The change is mentioned in the next phase's checklist.

Not done unless all four are true. "Looks right" is not done.
