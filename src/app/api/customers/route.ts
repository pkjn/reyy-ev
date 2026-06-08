import { NextResponse } from "next/server";
import ddb, { TABLE_NAME } from "@/lib/db";
import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { v4 as uuid } from "uuid";
import { CustomerId, isValidIdType } from "@/lib/idTypes";

function readPhones(item: Record<string, unknown>): string[] {
  if (Array.isArray(item.phones)) return item.phones as string[];
  if (typeof item.phone === "string" && item.phone.trim()) return [item.phone];
  return [];
}

// Normalise incoming ID payload from the client. Each row needs a type, a
// non-empty number, and an optional original-submitted flag. Returns rows
// stamped with a fresh UUID + createdAt so the server controls those.
function normaliseIds(raw: unknown): CustomerId[] {
  if (!Array.isArray(raw)) return [];
  const now = new Date().toISOString();
  const out: CustomerId[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const rec = r as Record<string, unknown>;
    const type = rec.type;
    const number = typeof rec.number === "string" ? rec.number.trim() : "";
    if (!isValidIdType(type) || !number) continue;
    out.push({
      id: typeof rec.id === "string" && rec.id ? rec.id : uuid(),
      type,
      number,
      originalSubmitted: rec.original_submitted === true || rec.originalSubmitted === true,
      createdAt:
        typeof rec.created_at === "string"
          ? rec.created_at
          : typeof rec.createdAt === "string"
            ? rec.createdAt
            : now,
    });
  }
  return out;
}

export async function GET() {
  const [custRes, rentRes] = await Promise.all([
    ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :pk",
        ExpressionAttributeValues: { ":pk": "CUSTOMERS" },
        ScanIndexForward: false,
      })
    ),
    ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :pk",
        ExpressionAttributeValues: { ":pk": "RENTALS" },
      })
    ),
  ]);

  const rentalsByCustomer = new Map<string, { total: number; active: number }>();
  for (const r of rentRes.Items || []) {
    const cid = r.customerId as string;
    if (!cid) continue;
    const entry = rentalsByCustomer.get(cid) || { total: 0, active: 0 };
    entry.total += 1;
    if (!r.endDate) entry.active += 1;
    rentalsByCustomer.set(cid, entry);
  }

  const customers = (custRes.Items || []).map((item) => {
    const stats = rentalsByCustomer.get(item.customerId as string) || { total: 0, active: 0 };
    return {
      id: item.customerId,
      name: item.name,
      phones: readPhones(item),
      address: item.address || null,
      map_location: item.mapLocation || null,
      id_count: Array.isArray(item.ids) ? (item.ids as unknown[]).length : 0,
      rental_count: stats.total,
      active_rentals: stats.active,
      created_at: item.createdAt,
    };
  });

  return NextResponse.json(customers);
}

export async function POST(req: Request) {
  const body = (await req.json()) as {
    name?: string;
    phones?: string[];
    address?: string;
    map_location?: string;
    ids?: unknown;
  };

  const name = (body.name || "").trim();
  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const phones = Array.from(
    new Set(
      (body.phones || [])
        .map((p) => (typeof p === "string" ? p.trim() : ""))
        .filter((p) => p.length > 0)
    )
  );

  const id = uuid();
  const now = new Date().toISOString();
  const address = (body.address || "").trim();
  const mapLocation = (body.map_location || "").trim();
  const ids = normaliseIds(body.ids);

  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `CUSTOMER#${id}`,
        SK: "PROFILE",
        GSI1PK: "CUSTOMERS",
        GSI1SK: now,
        customerId: id,
        name,
        phones: phones.length > 0 ? phones : undefined,
        address: address || undefined,
        mapLocation: mapLocation || undefined,
        ids: ids.length > 0 ? ids : undefined,
        createdAt: now,
      },
    })
  );

  return NextResponse.json(
    {
      id,
      name,
      phones,
      address: address || null,
      map_location: mapLocation || null,
      ids,
      created_at: now,
    },
    { status: 201 }
  );
}
