import { NextResponse } from "next/server";
import ddb, { TABLE_NAME } from "@/lib/db";
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { v4 as uuid } from "uuid";
import bcrypt from "bcryptjs";
import { normalisePhone } from "@/lib/driverAuth";
import { isValidDateString, isValidRateUnit } from "@/lib/billing";

const BCRYPT_ROUNDS = 10;

export async function POST(req: Request) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const name = (body.name || "").trim();
  const phoneInput = (body.phone || "").trim();
  const scootyLabel = (body.scooty_label || "").trim();
  const startDate = (body.start_date || "").trim();
  const rate = body.rate;
  const rateUnit = body.rate_unit;

  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });
  if (!phoneInput) return NextResponse.json({ error: "Phone is required" }, { status: 400 });
  if (!scootyLabel) return NextResponse.json({ error: "Scooty label is required" }, { status: 400 });
  if (!isValidDateString(startDate)) return NextResponse.json({ error: "start_date must be YYYY-MM-DD" }, { status: 400 });
  if (typeof rate !== "number" || rate < 0) return NextResponse.json({ error: "rate must be a non-negative number" }, { status: 400 });
  if (!isValidRateUnit(rateUnit)) return NextResponse.json({ error: "rate_unit must be day | week | month" }, { status: 400 });

  const phone = normalisePhone(phoneInput);
  if (!phone) {
    return NextResponse.json({ error: "Invalid phone number format" }, { status: 400 });
  }

  const customerId = uuid();
  const rentalId = uuid();
  const now = new Date().toISOString();

  // Hash the upper case scooty label for case-insensitive default driver password
  const driverPasswordHash = await bcrypt.hash(scootyLabel.toUpperCase(), BCRYPT_ROUNDS);

  try {
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          // 1. Create the customer profile
          {
            Put: {
              TableName: TABLE_NAME,
              Item: {
                PK: `CUSTOMER#${customerId}`,
                SK: "PROFILE",
                GSI1PK: "CUSTOMERS",
                GSI1SK: now,
                customerId,
                name,
                phones: [phone],
                createdAt: now,
                driverPasswordHash,
              },
              ConditionExpression: "attribute_not_exists(PK)",
            },
          },
          // 2. Uniqueness constraint for driver phone login
          {
            Put: {
              TableName: TABLE_NAME,
              Item: {
                PK: `PHONE#${phone}`,
                SK: "UNIQUE",
                customerId,
                createdAt: now,
              },
              ConditionExpression: "attribute_not_exists(PK)",
            },
          },
          // 3. Create the rental
          {
            Put: {
              TableName: TABLE_NAME,
              Item: {
                PK: `CUSTOMER#${customerId}`,
                SK: `RENTAL#${rentalId}`,
                GSI1PK: "RENTALS",
                GSI1SK: `${now}#${rentalId}`,
                rentalId,
                customerId,
                customerName: name,
                scootyLabel,
                startDate,
                rate,
                rateUnit,
                securityDeposit: 0,
                refundableDeposit: 0,
                createdAt: now,
              },
              ConditionExpression: "attribute_not_exists(SK)",
            },
          },
          // 4. Uniqueness constraint for the rental ID
          {
            Put: {
              TableName: TABLE_NAME,
              Item: {
                PK: `RENTALID#${rentalId}`,
                SK: "UNIQUE",
                rentalId,
                customerId,
                createdAt: now,
              },
              ConditionExpression: "attribute_not_exists(PK)",
            },
          },
        ],
      })
    );
  } catch (err: unknown) {
    console.error("Quick add transaction failed:", err);
    if (err instanceof Error && err.name === "TransactionCanceledException" && err.message.includes("ConditionalCheckFailed")) {
      return NextResponse.json(
        { error: "A customer with this phone number already exists." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ customer_id: customerId, rental_id: rentalId }, { status: 201 });
}
