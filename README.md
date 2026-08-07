# Reyy EV

Scooter rental management — customers, rentals, payments, rent-due dashboard.

Next.js 16 + React 19 + Tailwind 4. AWS DynamoDB (single-table) + S3 for backend. Deploy frontend to Vercel.

## Quick start

```bash
npm install
cp .env.example .env.local
# Fill in AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY (see AWS setup below)
npm run dev
```

Open <http://localhost:3000>.

## AWS setup

### 1. DynamoDB table

Single table named `ReyyEV` (override with `DYNAMODB_TABLE`). Schema:

| Attribute | Type | Role |
| --------- | ---- | ---- |
| `PK`      | S    | Partition key |
| `SK`      | S    | Sort key |
| `GSI1PK`  | S    | GSI1 partition key |
| `GSI1SK`  | S    | GSI1 sort key |

Create via AWS CLI:

```bash
aws dynamodb create-table \
  --table-name ReyyEV \
  --attribute-definitions \
    AttributeName=PK,AttributeType=S \
    AttributeName=SK,AttributeType=S \
    AttributeName=GSI1PK,AttributeType=S \
    AttributeName=GSI1SK,AttributeType=S \
  --key-schema AttributeName=PK,KeyType=HASH AttributeName=SK,KeyType=RANGE \
  --global-secondary-indexes \
    "IndexName=GSI1,KeySchema=[{AttributeName=GSI1PK,KeyType=HASH},{AttributeName=GSI1SK,KeyType=RANGE}],Projection={ProjectionType=ALL}" \
  --billing-mode PAY_PER_REQUEST \
  --region ap-south-1
```

### 2. S3 bucket

```bash
aws s3 mb s3://reyyev-media --region ap-south-1

# CORS so the browser can PUT directly via presigned URL
aws s3api put-bucket-cors --bucket reyyev-media --cors-configuration '{
  "CORSRules": [{
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "PUT"],
    "AllowedOrigins": ["http://localhost:3000", "https://<your-vercel-domain>"],
    "ExposeHeaders": ["ETag"]
  }]
}'
```

Keep the bucket private — the app uses pre-signed URLs for both upload and view.

### 3. IAM user

Create a user `reyyev-app` with programmatic access. Attach an inline policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem",
        "dynamodb:Query",
        "dynamodb:BatchWriteItem",
        "dynamodb:TransactWriteItems"
      ],
      "Resource": [
        "arn:aws:dynamodb:ap-south-1:*:table/ReyyEV",
        "arn:aws:dynamodb:ap-south-1:*:table/ReyyEV/index/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::reyyev-media/*"
    }
  ]
}
```

Copy the access key + secret into `.env.local`.

## Data model

Single-table DynamoDB. Every item shares this key shape:

| Item                  | `PK`               | `SK`                                  | `GSI1PK`           | `GSI1SK`               |
| --------------------- | ------------------ | ------------------------------------- | ------------------ | ---------------------- |
| Customer profile      | `CUSTOMER#<cid>`   | `PROFILE`                             | `CUSTOMERS`        | `<createdAt>`          |
| Customer photo        | `CUSTOMER#<cid>`   | `PHOTO#<pid>`                         | —                  | —                      |
| Rental                | `CUSTOMER#<cid>`   | `RENTAL#<rid>`                        | `RENTALS`          | `<createdAt>#<rid>`    |
| Rental ID uniqueness  | `RENTALID#<rid>`   | `UNIQUE`                              | —                  | —                      |
| Payment               | `CUSTOMER#<cid>`   | `PAYMENT#<rid>#<paidOn>#<payId>`      | `RENTAL#<rid>`     | `<paidOn>#<payId>`     |
| Document              | `DOC#<docId>`      | `PROFILE`                             | `DOCUMENTS`        | `<docDate>#<docId>`    |

Why this layout:

- `Query(PK = CUSTOMER#<id>)` returns a customer with **every** related row — profile, photos, rentals, payments — in one round trip.
- `GSI1PK = "CUSTOMERS" / "RENTALS"` lets us list each type without scanning.
- `GSI1PK = RENTAL#<id>` collects payments per rental for the dashboard.
- `RENTALID#<id>` is a global uniqueness marker so the same rental ID can never collide across customers.
- `GSI1SK = <docDate>#<docId>` returns the document vault already in document-date order.

## Documents & GST claims

`/documents` is a standalone vault for bills, GST certificates, cheques, photos, signed papers — anything worth keeping a scan of. Documents don't link to customers or vehicles; they're found by category, party and date.

Each document is one row with its scans inline as a `files` array (`fileId` + `s3Key`, objects under `documents/<docId>/`), so "one document, several pages" is a single read and a single delete. Files are uploaded straight to S3 via presigned PUT, same two-step flow as customer photos.

GST tracking is deliberately light — a document records the total, the GST inside it, and whether that input credit has been claimed:

```
gstAmount > 0 and gstClaimed  → claimed, in return period gstClaimPeriod (YYYY-MM)
gstAmount > 0 and !gstClaimed → still to claim
gstAmount empty              → not a GST document, no claim badge
```

The page totals GST **on record / claimed / yet to claim** across the whole vault, filters by claim state, and breaks claimed credit down by return period. A claim needs a period, GST can't exceed the total, and clearing the GST amount off a claimed document clears the claim with it.

| Route                                    | Purpose                                    |
| ---------------------------------------- | ------------------------------------------ |
| `GET/POST /api/documents`                | list the vault / file a new document       |
| `GET/PATCH/DELETE /api/documents/<id>`   | read, edit or tick a claim / delete + scans |
| `POST /api/documents/<id>/files`         | attach more scans                          |
| `DELETE /api/documents/<id>/files/<fid>` | remove one scan                            |

## Rent-due math

`src/lib/billing.ts`:

```
daysBilled  = floor((min(today, endDate) − startDate) / 1 day) + 1
totalBilled = daysBilled × perDayRate(rate, rateUnit)   // week→/7, month→/30
outstanding = max(0, totalBilled − sum(payments))
```

Dashboard buckets each rental by `outstanding / dailyRate` ≈ days behind:
**current (<1d)**, **1–7 d**, **8+ d**.

## Deploy to Vercel

1. Push to GitHub.
2. Import into Vercel.
3. Add env vars: `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `DYNAMODB_TABLE`, `S3_BUCKET`.
4. Add your Vercel domain to the S3 CORS `AllowedOrigins`.
