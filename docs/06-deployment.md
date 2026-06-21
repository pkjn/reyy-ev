# Deployment Guide

This document covers three deployment scenarios for the Reyy EV platform (Dashboard + Driver App).

---

## Prerequisites

| Tool | Purpose | Install |
|------|---------|---------|
| Node.js 18+ | Runtime | https://nodejs.org |
| Git | Version control | https://git-scm.com |
| Expo Go app | Run driver app on phone (dev) | Play Store / App Store |
| EAS CLI | Build APKs in the cloud | `npm install -g eas-cli` |
| Vercel account | Host dashboard | https://vercel.com |
| Expo account | Build driver APK | https://expo.dev |
| AWS account | DynamoDB + S3 backend | https://aws.amazon.com |

### AWS Setup (one-time)

See the main [README.md](../README.md) for DynamoDB table creation, S3 bucket setup, and IAM user creation.

---

## Scenario 1 — Local Development

> Run the dashboard on localhost and the driver app in Expo Go, both on your local network.

### 1.1 Start the Dashboard

```bash
# From the project root (reyy-ev/)
npm install
cp .env.example .env.local
# Fill in AWS credentials, SITE_PASSWORD, JWT_SECRET in .env.local

npm run dev
```

Dashboard is now at **http://localhost:3000** (also accessible via your LAN IP on port 3000).

### 1.2 Find Your Local IP

```bash
# Windows
ipconfig
# Look for "IPv4 Address" under your Wi-Fi adapter, e.g. 192.168.1.18

# macOS / Linux
ifconfig | grep "inet "
```

### 1.3 Point the Driver App to Localhost

Edit `driver-app/app.json` — set `API_BASE_URL` to your local IP:

```json
"extra": {
  "API_BASE_URL": "http://192.168.1.18:3000"
}
```

Also update the fallback in `driver-app/config/env.ts`:

```typescript
export const API_BASE_URL =
  Constants.expoConfig?.extra?.API_BASE_URL || "http://192.168.1.18:3000";
```

> **Note:** Replace `192.168.1.18` with your actual LAN IP. Use your LAN IP (not `localhost` or `127.0.0.1`) so the phone can reach your computer.

### 1.4 Run the Driver App

```bash
cd driver-app
npm install
npx expo start
```

Scan the QR code with the **Expo Go** app on your phone. Both your phone and computer must be on the same Wi-Fi network.

### 1.5 SITE_PASSWORD (optional for local dev)

If `SITE_PASSWORD` is empty or not set in `.env.local`, the password gate is disabled — you can access the dashboard without logging in. Set it if you want to test the login flow.

---

## Scenario 2 — Deploy Dashboard on Vercel + Driver App in Expo Go

> Dashboard runs on Vercel (public internet). Driver app runs in Expo Go pointed at the Vercel URL.

### 2.1 Push Code to GitHub

```bash
# From the project root
git add -A
git commit -m "deploy"

# If using personal GitHub (github.com/pkjn/reyy-ev):
git push personal driver-app:main

# Or push to whichever remote/branch Vercel is configured to watch
```

### 2.2 Deploy on Vercel

1. Go to **https://vercel.com/new**
2. Import the GitHub repo
3. Framework preset: **Next.js** (auto-detected)
4. Add these **Environment Variables**:

| Variable | Value | Notes |
|----------|-------|-------|
| `AWS_REGION` | `ap-south-1` | Your DynamoDB/S3 region |
| `AWS_ACCESS_KEY_ID` | *(your key)* | From IAM user |
| `AWS_SECRET_ACCESS_KEY` | *(your secret)* | From IAM user |
| `DYNAMODB_TABLE` | `ReyyEV` | Or your custom table name |
| `S3_BUCKET` | `reyyev-media` | Or your custom bucket |
| `SITE_PASSWORD` | *(choose a password)* | Gates the admin dashboard |
| `JWT_SECRET` | *(random 32+ byte string)* | For driver app auth |
| `SUPPORT_PHONE` | *(optional)* | Shown to drivers for calling ops |

5. Click **Deploy**

### 2.3 Update S3 CORS

Add your Vercel domain to the S3 bucket's CORS allowed origins. Via AWS Console:

1. Go to **S3 → reyyev-media → Permissions → CORS**
2. Add your Vercel domain:

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "PUT"],
    "AllowedOrigins": [
      "http://localhost:3000",
      "https://reyy-ev-jet.vercel.app"
    ],
    "ExposeHeaders": ["ETag"]
  }
]
```

Or via AWS CLI:

```bash
aws s3api put-bucket-cors --bucket reyyev-media --cors-configuration '{
  "CORSRules": [{
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "PUT"],
    "AllowedOrigins": ["http://localhost:3000", "https://reyy-ev-jet.vercel.app"],
    "ExposeHeaders": ["ETag"]
  }]
}'
```

> Replace `reyy-ev-jet.vercel.app` with your actual Vercel domain.

### 2.4 Point Driver App to Vercel

Edit `driver-app/app.json`:

```json
"extra": {
  "API_BASE_URL": "https://reyy-ev-jet.vercel.app"
}
```

Edit `driver-app/config/env.ts`:

```typescript
export const API_BASE_URL =
  Constants.expoConfig?.extra?.API_BASE_URL || "https://reyy-ev-jet.vercel.app";
```

### 2.5 Run Driver App in Expo Go

```bash
cd driver-app
npx expo start
```

Scan the QR code. The driver app now talks to Vercel — no local `npm run dev` needed.

---

## Scenario 3 — Deploy Dashboard on Vercel + Build Driver App APK

> Full production setup. Dashboard on Vercel, driver app as an installable APK.

### 3.1 Deploy Dashboard on Vercel

Follow Steps 2.1–2.3 above.

### 3.2 Point Driver App to Vercel

Follow Step 2.4 above — set `API_BASE_URL` to your Vercel domain in both `app.json` and `config/env.ts`.

### 3.3 Install & Login to EAS CLI

```bash
npm install -g eas-cli
eas login
```

This opens a browser window to log in to your Expo account.

### 3.4 Initialize EAS Project (first time only)

```bash
cd driver-app
eas init
```

This links the project to your Expo account and adds the `eas.projectId` to `app.json`.

### 3.5 Create `eas.json` (first time only)

Create `driver-app/eas.json` if it doesn't exist:

```json
{
  "cli": {
    "version": ">= 15.0.0"
  },
  "build": {
    "preview": {
      "android": {
        "buildType": "apk"
      }
    },
    "production": {
      "android": {
        "buildType": "app-bundle"
      }
    }
  }
}
```

- **`preview`** profile → builds an `.apk` file (sideload directly to phone)
- **`production`** profile → builds an `.aab` file (upload to Google Play Store)

### 3.6 Build the APK

```bash
cd driver-app
eas build --platform android --profile preview
```

This uploads your code to EAS servers and builds in the cloud (~5–10 minutes). When done, you'll get a **download link** for the APK.

You can also check build status at:
**https://expo.dev/accounts/prateek.jn/projects/reyyev-driver/builds**

### 3.7 Install the APK

1. Download the APK on your Android phone (or transfer from computer)
2. Open the APK → allow "Install from unknown sources" if prompted
3. The app is installed and connects directly to your Vercel backend

### 3.8 Rebuild APK After Code Changes

Whenever you update the driver app code:

```bash
cd driver-app
eas build --platform android --profile preview
```

A new APK will be built with the latest code.

---

## Quick Reference

| What | Local Dev | Vercel + Expo Go | Vercel + APK |
|------|-----------|------------------|--------------|
| Dashboard | `npm run dev` | Vercel | Vercel |
| Driver app | Expo Go (LAN IP) | Expo Go (Vercel URL) | APK (Vercel URL) |
| `API_BASE_URL` | `http://<LAN_IP>:3000` | `https://<vercel>.app` | `https://<vercel>.app` |
| Needs local server? | Yes | No | No |
| Needs Expo Go? | Yes | Yes | No |

## Environment Files

| File | Purpose | Committed? |
|------|---------|------------|
| `.env.example` | Template with all variables | ✅ Yes |
| `.env.local` | Actual secrets for local dev | ❌ No (gitignored) |
| Vercel Environment Variables | Production secrets | N/A (Vercel dashboard) |
| `driver-app/app.json` → `extra.API_BASE_URL` | Where the driver app connects | ✅ Yes |
| `driver-app/config/env.ts` | Fallback URL | ✅ Yes |
