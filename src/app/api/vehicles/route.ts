import { NextResponse } from "next/server";
import ddb, { TABLE_NAME } from "@/lib/db";
import {
  QueryCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { v4 as uuid } from "uuid";
import { normalizePlate, VehicleAssignment } from "@/lib/vehicles";

// Map every active rental's *current* plate to the customer holding it. A
// rental's scootyLabel is kept in sync on swap, so this reflects the latest
// hand-over. The "since" date is when the current scooty was handed over.
async function currentAssignments(): Promise<Map<string, VehicleAssignment>> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :pk",
      ExpressionAttributeValues: { ":pk": "RENTALS" },
      // Oldest first, so a later active rental on the same plate wins.
      ScanIndexForward: true,
    })
  );
  const byPlate = new Map<string, VehicleAssignment>();
  for (const r of res.Items || []) {
    if (r.endDate) continue; // only vehicles currently out on rent
    const label = (r.scootyLabel as string) || "";
    if (!label) continue;
    // The current scooty's hand-over date: last entry of the swap history,
    // falling back to the rental start for pre-swap rentals.
    const scooties = Array.isArray(r.scooties)
      ? (r.scooties as Record<string, unknown>[])
      : [];
    const since =
      (scooties[scooties.length - 1]?.from as string) ||
      (r.startDate as string) ||
      null;
    // Key by the normalised plate so the vehicle match is case- and
    // whitespace-insensitive (rentals may store "REYY-0005" for "Reyy-0005").
    byPlate.set(normalizePlate(label), {
      customer_id: (r.customerId as string) || "",
      customer_name: (r.customerName as string) || "",
      rental_id: (r.rentalId as string) || "",
      since,
    });
  }
  return byPlate;
}

// The most recent odometer reading (km) for a vehicle, or null if none logged.
// Readings sort chronologically by SK (ODO#<date>#<id>), so the last one wins.
async function latestKm(vehicleId: string): Promise<number | null> {
  const r = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: { ":pk": `VEHICLE#${vehicleId}`, ":sk": "ODO#" },
      ScanIndexForward: false,
      Limit: 1,
    })
  );
  const item = (r.Items || [])[0];
  return item ? (item.km as number) : null;
}

// GET /api/vehicles — every vehicle with its current renter (if any),
// alphabetical by plate.
export async function GET() {
  const [vehiclesRes, assignments] = await Promise.all([
    ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :pk",
        ExpressionAttributeValues: { ":pk": "VEHICLES" },
      })
    ),
    currentAssignments(),
  ]);

  const vehicles = await Promise.all(
    (vehiclesRes.Items || []).map(async (v) => {
      const number = v.number as string;
      return {
        id: v.vehicleId as string,
        number,
        make: (v.make as string) || "",
        chassis_number: (v.chassisNumber as string) || "",
        battery_provider: (v.batteryProvider as string) || "",
        created_at: v.createdAt as string,
        assignment: assignments.get(normalizePlate(number)) || null,
        latest_km: await latestKm(v.vehicleId as string),
      };
    })
  );

  return NextResponse.json(vehicles);
}

// POST /api/vehicles — register a vehicle. Writes the profile row plus a
// VEHICLENO#<normalized>/UNIQUE marker in one transaction so the same plate
// can't be added twice.
export async function POST(req: Request) {
  const body = (await req.json()) as {
    number?: string;
    make?: string;
    chassis_number?: string;
    battery_provider?: string;
  };

  const number = (body.number || "").trim();
  const make = (body.make || "").trim();
  const chassisNumber = (body.chassis_number || "").trim();
  const batteryProvider = (body.battery_provider || "").trim();

  if (!number) {
    return NextResponse.json({ error: "number is required" }, { status: 400 });
  }
  if (!make) {
    return NextResponse.json({ error: "make is required" }, { status: 400 });
  }
  if (!chassisNumber) {
    return NextResponse.json(
      { error: "chassis_number is required" },
      { status: 400 }
    );
  }
  if (!batteryProvider) {
    return NextResponse.json(
      { error: "battery_provider is required" },
      { status: 400 }
    );
  }

  const id = uuid();
  const now = new Date().toISOString();
  const normalized = normalizePlate(number);

  try {
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: TABLE_NAME,
              Item: {
                PK: `VEHICLE#${id}`,
                SK: "PROFILE",
                GSI1PK: "VEHICLES",
                // Lower-cased plate gives a stable alphabetical sort.
                GSI1SK: number.toLowerCase(),
                vehicleId: id,
                number,
                make,
                chassisNumber,
                batteryProvider,
                createdAt: now,
              },
              ConditionExpression: "attribute_not_exists(PK)",
            },
          },
          {
            Put: {
              TableName: TABLE_NAME,
              Item: {
                PK: `VEHICLENO#${normalized}`,
                SK: "UNIQUE",
                vehicleId: id,
                createdAt: now,
              },
              ConditionExpression: "attribute_not_exists(PK)",
            },
          },
        ],
      })
    );
  } catch (err: unknown) {
    if (
      typeof err === "object" &&
      err !== null &&
      "name" in err &&
      (err as { name: string }).name === "TransactionCanceledException"
    ) {
      return NextResponse.json(
        { error: `A vehicle with number "${number}" already exists.` },
        { status: 409 }
      );
    }
    throw err;
  }

  return NextResponse.json(
    {
      id,
      number,
      make,
      chassis_number: chassisNumber,
      battery_provider: batteryProvider,
      created_at: now,
      assignment: null,
    },
    { status: 201 }
  );
}
