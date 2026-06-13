import { NextResponse } from "next/server";
import ddb, { TABLE_NAME } from "@/lib/db";
import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { v4 as uuid } from "uuid";
import { isValidDateString } from "@/lib/billing";

// POST /api/rentals/[id]/kms
// Body: { customer_id, kms, date, note? }
// Logs a new odometer reading for a rental scooty. Ensures that:
// 1. The reading is non-negative.
// 2. The reading is not lower than the last logged reading for this rental.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: rentalId } = await params;
  const body = (await req.json()) as {
    customer_id?: string;
    kms?: number;
    date?: string;
    note?: string;
  };

  const customerId = (body.customer_id || "").trim();
  const date = (body.date || "").trim();

  if (!customerId) {
    return NextResponse.json(
      { error: "customer_id is required" },
      { status: 400 }
    );
  }

  if (typeof body.kms !== "number" || body.kms < 0) {
    return NextResponse.json(
      { error: "kms must be a non-negative number" },
      { status: 400 }
    );
  }

  if (!isValidDateString(date)) {
    return NextResponse.json(
      { error: "date must be YYYY-MM-DD" },
      { status: 400 }
    );
  }

  // Get rental to confirm existence and read current scooty label
  const rentalRes = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `CUSTOMER#${customerId}`, SK: `RENTAL#${rentalId}` },
    })
  );

  if (!rentalRes.Item) {
    return NextResponse.json({ error: "Rental not found" }, { status: 404 });
  }

  const scootyLabel = (rentalRes.Item.scootyLabel as string) || "";

  // Query all historical KMS logs for this rental to find the highest logged reading so far
  const kmsLogsRes = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": `CUSTOMER#${customerId}`,
        ":sk": `KMSLOG#${rentalId}#`,
      },
    })
  );

  const logs = kmsLogsRes.Items || [];
  if (logs.length > 0) {
    const currentScootyLogs = logs.filter((l) => l.scootyLabel === scootyLabel);
    if (currentScootyLogs.length > 0) {
      const maxKms = Math.max(...currentScootyLogs.map((l) => (l.kms as number) || 0));
      if (body.kms < maxKms) {
        return NextResponse.json(
          {
            error: `Odometer reading cannot be lower than the previous maximum of ${maxKms.toLocaleString(
              "en-IN"
            )} km for scooty ${scootyLabel}.`,
          },
          { status: 400 }
        );
      }
    }
  }

  const kmsLogId = uuid();
  const now = new Date().toISOString();
  const note = (body.note || "").trim();

  const item = {
    PK: `CUSTOMER#${customerId}`,
    SK: `KMSLOG#${rentalId}#${date}#${kmsLogId}`,
    kmsLogId,
    rentalId,
    customerId,
    scootyLabel,
    kms: body.kms,
    date,
    note: note || undefined,
    createdAt: now,
  };

  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: item,
    })
  );

  return NextResponse.json(
    {
      id: kmsLogId,
      rental_id: rentalId,
      customer_id: customerId,
      scooty_label: scootyLabel,
      kms: body.kms,
      date,
      note: note || null,
      created_at: now,
    },
    { status: 201 }
  );
}
