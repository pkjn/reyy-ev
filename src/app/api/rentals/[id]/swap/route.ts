import { NextResponse } from "next/server";
import ddb, { TABLE_NAME } from "@/lib/db";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { isValidDateString } from "@/lib/billing";

interface ScootyAssignment {
  label: string;
  from: string; // YYYY-MM-DD the scooty was handed over
  note?: string;
}

// Read a rental's scooty history, synthesising the first assignment from the
// legacy single `scootyLabel` for rentals created before swaps were tracked.
export function readScooties(
  item: Record<string, unknown>
): ScootyAssignment[] {
  if (Array.isArray(item.scooties) && item.scooties.length > 0) {
    return (item.scooties as Record<string, unknown>[]).map((s) => ({
      label: (s.label as string) || "",
      from: (s.from as string) || (item.startDate as string),
      note: (s.note as string) || undefined,
    }));
  }
  return [
    { label: (item.scootyLabel as string) || "", from: item.startDate as string },
  ];
}

// POST /api/rentals/<rentalId>/swap
// Body: { customer_id, scooty_label, swap_date, note? }
// Hands the customer a new scooty on swap_date — appends to the assignment
// history and updates the denormalised current label.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: rentalId } = await params;
  const body = (await req.json()) as {
    customer_id?: string;
    scooty_label?: string;
    swap_date?: string;
    note?: string;
  };

  let customerId = (body.customer_id || "").trim();
  if (!customerId) {
    const markerRes = await ddb.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: `RENTALID#${rentalId}`, SK: "UNIQUE" },
      })
    );
    customerId = (markerRes.Item?.customerId as string) || "";
  }
  if (!customerId) {
    return NextResponse.json({ error: "Rental not found" }, { status: 404 });
  }

  const newLabel = (body.scooty_label || "").trim();
  if (!newLabel) {
    return NextResponse.json(
      { error: "scooty_label is required" },
      { status: 400 }
    );
  }
  const swapDate = (body.swap_date || "").trim();
  if (!isValidDateString(swapDate)) {
    return NextResponse.json(
      { error: "swap_date must be YYYY-MM-DD" },
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

  const scooties = readScooties(rentalRes.Item);
  const current = scooties[scooties.length - 1];
  if (current.label === newLabel) {
    return NextResponse.json(
      { error: "That's already the current scooty" },
      { status: 400 }
    );
  }
  if (swapDate < current.from) {
    return NextResponse.json(
      { error: "swap_date can't be before the current scooty was handed over" },
      { status: 400 }
    );
  }

  const note = (body.note || "").trim();
  scooties.push({ label: newLabel, from: swapDate, note: note || undefined });

  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: `CUSTOMER#${customerId}`, SK: `RENTAL#${rentalId}` },
      UpdateExpression: "SET scooties = :s, scootyLabel = :label",
      ExpressionAttributeValues: { ":s": scooties, ":label": newLabel },
    })
  );

  return NextResponse.json({ ok: true, scooties });
}
