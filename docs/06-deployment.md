# Deployment Guide

## Dashboard Backend (Next.js)

1. Push the `reyy-ev` root repository to GitHub.
2. Import the project into Vercel.
3. Configure the following environment variables in Vercel:
   - `AWS_REGION`
   - `AWS_ACCESS_KEY_ID`
   - `AWS_SECRET_ACCESS_KEY`
   - `DYNAMODB_TABLE` (e.g. `ReyyEV`)
   - `S3_BUCKET` (e.g. `reyyev-media`)
   - `SITE_PASSWORD` (Your admin password)
   - `JWT_SECRET` (Generate a new secure random string)
   - `SUPPORT_PHONE` (Optional, shown on driver home page)

4. Update your AWS S3 Bucket CORS policy to allow the new Vercel domain:
   ```json
   {
     "CORSRules": [
       {
         "AllowedHeaders": ["*"],
         "AllowedMethods": ["GET", "PUT"],
         "AllowedOrigins": ["http://localhost:3000", "https://your-vercel-domain.vercel.app"],
         "ExposeHeaders": ["ETag"]
       }
     ]
   }
   ```

## Driver App (Expo)

To switch the driver app from your local development machine (localhost/WSL IP) to the production Vercel deployment:

1. Open `driver-app/app.json`.
2. Locate the `extra` configuration at the bottom of the file.
3. Change the `API_BASE_URL` to your Vercel deployment URL:
   ```json
   "extra": {
     "API_BASE_URL": "https://your-vercel-domain.vercel.app"
   }
   ```
4. Re-build the app or publish an OTA update using EAS Update.
