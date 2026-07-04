import { NextResponse } from "next/server";
import ddb, { TABLE_NAME } from "@/lib/db";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { isValidDateString, readPauses } from "@/lib/billing";

async function resolveCustomerId(
  rentalId: string,
  fromBody: string | undefined
): Promise<string> {
  const given = (fromBody || "").trim();
  if (given) return given;
  const marker = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `RENTALID#${rentalId}`, SK: "UNIQUE" },
    })
  );
  return (marker.Item?.customerId as string) || "";
}

// POST /api/rentals/<rentalId>/pause
// Body: { customer_id?, date? } — freezes billing from `date` (default today).
// Opens a new pause span; the rental stays active but stops accruing charges.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: rentalId } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    customer_id?: string;
    date?: string;
  };

  const customerId = await resolveCustomerId(rentalId, body.customer_id);
  if (!customerId) {
    return NextResponse.json({ error: "Rental not found" }, { status: 404 });
  }

  const date = (body.date || new Date().toISOString().slice(0, 10)).trim();
  if (!isValidDateString(date)) {
    return NextResponse.json(
      { error: "date must be YYYY-MM-DD" },
      { status: 400 }
    );
  }

  const rentalRes = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `CUSTOMER#${customerId}`, SK: `RENTAL#${rentalId}` },
    })
  );
  if (!rentalRes.Item) {
    return NextResponse.json({ error: "Rental not found" }, { status: 404 });
  }
  if (rentalRes.Item.endDate) {
    return NextResponse.json(
      { error: "Can't pause a closed rental" },
      { status: 400 }
    );
  }

  const startDate = rentalRes.Item.startDate as string;
  if (date < startDate) {
    return NextResponse.json(
      { error: "Pause date can't be before the rental started" },
      { status: 400 }
    );
  }

  const pauses = readPauses(rentalRes.Item);
  if (pauses.some((p) => p.end === null)) {
    return NextResponse.json(
      { error: "Rental is already paused" },
      { status: 400 }
    );
  }
  // A new pause can't start before the previous one resumed, else the frozen
  // spans would overlap and double-discount the billing.
  const lastEnd = pauses.reduce<string | null>(
    (max, p) => (p.end && (!max || p.end > max) ? p.end : max),
    null
  );
  if (lastEnd && date < lastEnd) {
    return NextResponse.json(
      { error: `Pause date can't be before the last resume (${lastEnd})` },
      { status: 400 }
    );
  }

  pauses.push({ start: date, end: null });

  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: `CUSTOMER#${customerId}`, SK: `RENTAL#${rentalId}` },
      UpdateExpression: "SET pauses = :p",
      ExpressionAttributeValues: { ":p": pauses },
    })
  );

  return NextResponse.json({ ok: true, pauses });
}

// PATCH /api/rentals/<rentalId>/pause
// Body: { customer_id?, date? } — resumes billing on `date` (default today).
// Closes the open pause span; `date` is the first day billed again.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: rentalId } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    customer_id?: string;
    date?: string;
  };

  const customerId = await resolveCustomerId(rentalId, body.customer_id);
  if (!customerId) {
    return NextResponse.json({ error: "Rental not found" }, { status: 404 });
  }

  const date = (body.date || new Date().toISOString().slice(0, 10)).trim();
  if (!isValidDateString(date)) {
    return NextResponse.json(
      { error: "date must be YYYY-MM-DD" },
      { status: 400 }
    );
  }

  const rentalRes = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `CUSTOMER#${customerId}`, SK: `RENTAL#${rentalId}` },
    })
  );
  if (!rentalRes.Item) {
    return NextResponse.json({ error: "Rental not found" }, { status: 404 });
  }

  const pauses = readPauses(rentalRes.Item);
  const open = pauses.find((p) => p.end === null);
  if (!open) {
    return NextResponse.json(
      { error: "Rental is not paused" },
      { status: 400 }
    );
  }
  if (date < open.start) {
    return NextResponse.json(
      { error: "Resume date can't be before the pause started" },
      { status: 400 }
    );
  }
  open.end = date;

  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: `CUSTOMER#${customerId}`, SK: `RENTAL#${rentalId}` },
      UpdateExpression: "SET pauses = :p",
      ExpressionAttributeValues: { ":p": pauses },
    })
  );

  return NextResponse.json({ ok: true, pauses });
}
