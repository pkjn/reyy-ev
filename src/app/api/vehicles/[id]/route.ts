import { NextResponse } from "next/server";
import ddb, { TABLE_NAME } from "@/lib/db";
import {
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { JourneyLeg, normalizePlate, OdometerReading } from "@/lib/vehicles";

// A rental's scooty assignment history, synthesising the first leg from the
// legacy single `scootyLabel` for rentals created before swaps were tracked.
// (Mirrors readScooties in the swap route — kept local so this route is
// self-contained.)
function readScooties(
  item: Record<string, unknown>
): { label: string; from: string; note?: string }[] {
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

// GET /api/vehicles/<id> — profile + custody journey + odometer log.
// The journey is derived: scan every rental, and for each leg of its scooty
// history that matches this plate, emit the stretch it spent with that
// customer. Sorted chronologically, the first leg is where the vehicle began
// and the last (open) leg is who holds it now.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const profileRes = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `VEHICLE#${id}`, SK: "PROFILE" },
    })
  );
  if (!profileRes.Item) {
    return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });
  }
  const v = profileRes.Item;
  const target = normalizePlate(v.number as string);

  const [rentalsRes, odoRes] = await Promise.all([
    ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :pk",
        ExpressionAttributeValues: { ":pk": "RENTALS" },
      })
    ),
    ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: { ":pk": `VEHICLE#${id}`, ":sk": "ODO#" },
        ScanIndexForward: true,
      })
    ),
  ]);

  const journey: JourneyLeg[] = [];
  for (const r of rentalsRes.Items || []) {
    const scooties = readScooties(r);
    for (let i = 0; i < scooties.length; i++) {
      const s = scooties[i];
      if (normalizePlate(s.label) !== target) continue;
      const next = scooties[i + 1];
      const to = next ? next.from : ((r.endDate as string) || null);
      journey.push({
        rental_id: r.rentalId as string,
        customer_id: r.customerId as string,
        customer_name: (r.customerName as string) || "",
        from: s.from,
        to,
        current: !next && !r.endDate,
        handover_note: s.note || null,
        return_note: next?.note || null,
      });
    }
  }
  // Chronological by hand-over date; break ties on the return date so a
  // same-day swap still reads in order.
  journey.sort((a, b) =>
    a.from < b.from ? -1 : a.from > b.from ? 1 : (a.to || "") < (b.to || "") ? -1 : 1
  );

  const odometer: OdometerReading[] = (odoRes.Items || []).map((o) => ({
    id: o.readingId as string,
    date: o.date as string,
    km: (o.km as number) || 0,
    note: (o.note as string) || null,
    created_at: o.createdAt as string,
  }));
  const latestKm = odometer.length ? odometer[odometer.length - 1].km : null;
  const firstKm = odometer.length ? odometer[0].km : null;
  const totalKm =
    latestKm != null && firstKm != null ? latestKm - firstKm : null;

  return NextResponse.json({
    id: v.vehicleId,
    number: v.number,
    make: (v.make as string) || "",
    chassis_number: (v.chassisNumber as string) || "",
    battery_provider: (v.batteryProvider as string) || "",
    created_at: v.createdAt,
    journey,
    odometer,
    latest_km: latestKm,
    total_km: totalKm,
  });
}

// Is this plate currently out on an active rental? Used to block deletes so a
// vehicle's history stays traceable while it's assigned.
async function activeRentalForPlate(number: string): Promise<boolean> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :pk",
      ExpressionAttributeValues: { ":pk": "RENTALS" },
    })
  );
  const target = normalizePlate(number);
  return (res.Items || []).some(
    (r) => !r.endDate && normalizePlate((r.scootyLabel as string) || "") === target
  );
}

// PATCH /api/vehicles/<id> — edit the spec fields (make / chassis / battery).
// The plate `number` is immutable: it's the join key back to rentals, so
// changing it would orphan the vehicle's rental history. Replace the vehicle
// instead if a plate was mis-entered.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await req.json()) as {
    make?: string;
    chassis_number?: string;
    battery_provider?: string;
  };

  const setParts: string[] = [];
  const exprNames: Record<string, string> = {};
  const exprValues: Record<string, unknown> = {};

  if (body.make !== undefined) {
    const make = body.make.trim();
    if (!make) {
      return NextResponse.json({ error: "make cannot be empty" }, { status: 400 });
    }
    exprNames["#make"] = "make";
    exprValues[":make"] = make;
    setParts.push("#make = :make");
  }
  if (body.chassis_number !== undefined) {
    const chassis = body.chassis_number.trim();
    if (!chassis) {
      return NextResponse.json(
        { error: "chassis_number cannot be empty" },
        { status: 400 }
      );
    }
    exprNames["#chassis"] = "chassisNumber";
    exprValues[":chassis"] = chassis;
    setParts.push("#chassis = :chassis");
  }
  if (body.battery_provider !== undefined) {
    const battery = body.battery_provider.trim();
    if (!battery) {
      return NextResponse.json(
        { error: "battery_provider cannot be empty" },
        { status: 400 }
      );
    }
    exprNames["#battery"] = "batteryProvider";
    exprValues[":battery"] = battery;
    setParts.push("#battery = :battery");
  }

  if (setParts.length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  try {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { PK: `VEHICLE#${id}`, SK: "PROFILE" },
        UpdateExpression: `SET ${setParts.join(", ")}`,
        ExpressionAttributeNames: exprNames,
        ExpressionAttributeValues: exprValues,
        ConditionExpression: "attribute_exists(PK)",
      })
    );
  } catch (err: unknown) {
    if (
      typeof err === "object" &&
      err !== null &&
      "name" in err &&
      (err as { name: string }).name === "ConditionalCheckFailedException"
    ) {
      return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });
    }
    throw err;
  }

  return NextResponse.json({ ok: true });
}

// DELETE /api/vehicles/<id> — only when the vehicle isn't currently out on an
// active rental. Removes the profile row and its uniqueness marker together.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const profileRes = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `VEHICLE#${id}`, SK: "PROFILE" },
    })
  );
  if (!profileRes.Item) {
    return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });
  }
  const number = profileRes.Item.number as string;

  if (await activeRentalForPlate(number)) {
    return NextResponse.json(
      {
        error:
          "Vehicle is currently rented out — close or swap the rental before deleting it.",
      },
      { status: 409 }
    );
  }

  await ddb.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Delete: {
            TableName: TABLE_NAME,
            Key: { PK: `VEHICLE#${id}`, SK: "PROFILE" },
          },
        },
        {
          Delete: {
            TableName: TABLE_NAME,
            Key: { PK: `VEHICLENO#${normalizePlate(number)}`, SK: "UNIQUE" },
          },
        },
      ],
    })
  );

  return NextResponse.json({ ok: true });
}
