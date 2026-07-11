import { NextResponse } from "next/server";
import ddb, { TABLE_NAME } from "@/lib/db";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { v4 as uuid } from "uuid";
import { isValidDateString } from "@/lib/billing";

// POST /api/vehicles/<id>/odometer — log an odometer reading (km on a date).
// Stored as PK=VEHICLE#<id>, SK=ODO#<date>#<readingId> so readings sort
// chronologically and the latest one is the current km.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await req.json()) as {
    date?: string;
    km?: number;
    note?: string;
  };

  const date = (body.date || "").trim();
  if (!isValidDateString(date)) {
    return NextResponse.json(
      { error: "date must be YYYY-MM-DD" },
      { status: 400 }
    );
  }
  if (typeof body.km !== "number" || !Number.isFinite(body.km) || body.km < 0) {
    return NextResponse.json(
      { error: "km must be a non-negative number" },
      { status: 400 }
    );
  }
  const km = Math.round(body.km);

  // Guard against logging a reading for a vehicle that doesn't exist.
  const profileRes = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `VEHICLE#${id}`, SK: "PROFILE" },
    })
  );
  if (!profileRes.Item) {
    return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });
  }

  const readingId = uuid();
  const now = new Date().toISOString();
  const note = (body.note || "").trim();

  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `VEHICLE#${id}`,
        SK: `ODO#${date}#${readingId}`,
        readingId,
        vehicleId: id,
        date,
        km,
        note: note || undefined,
        createdAt: now,
      },
    })
  );

  return NextResponse.json(
    { id: readingId, date, km, note: note || null, created_at: now },
    { status: 201 }
  );
}
