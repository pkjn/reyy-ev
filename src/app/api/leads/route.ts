import { NextResponse } from "next/server";
import ddb, { TABLE_NAME } from "@/lib/db";
import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { v4 as uuid } from "uuid";
import { isValidStatus, LeadStatus } from "@/lib/leads";

function readPhones(item: Record<string, unknown>): string[] {
  if (Array.isArray(item.phones)) return item.phones as string[];
  return [];
}

function cleanPhones(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return Array.from(
    new Set(
      raw
        .map((p) => (typeof p === "string" ? p.trim() : ""))
        .filter((p) => p.length > 0)
    )
  );
}

export async function GET() {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :pk",
      ExpressionAttributeValues: { ":pk": "LEADS" },
      ScanIndexForward: false,
    })
  );

  const leads = (res.Items || []).map((item) => ({
    id: item.leadId,
    name: item.name,
    phones: readPhones(item),
    notes: item.notes || null,
    status: (isValidStatus(item.status) ? item.status : "new") as LeadStatus,
    created_at: item.createdAt,
  }));

  return NextResponse.json(leads);
}

export async function POST(req: Request) {
  const body = (await req.json()) as {
    name?: string;
    phones?: unknown;
    notes?: string;
    status?: unknown;
  };

  const name = (body.name || "").trim();
  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const id = uuid();
  const now = new Date().toISOString();
  const phones = cleanPhones(body.phones);
  const notes = (body.notes || "").trim();
  const status: LeadStatus = isValidStatus(body.status) ? body.status : "new";

  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `LEAD#${id}`,
        SK: "PROFILE",
        GSI1PK: "LEADS",
        GSI1SK: now,
        leadId: id,
        name,
        phones: phones.length > 0 ? phones : undefined,
        notes: notes || undefined,
        status,
        createdAt: now,
        updatedAt: now,
      },
    })
  );

  return NextResponse.json(
    {
      id,
      name,
      phones,
      notes: notes || null,
      status,
      created_at: now,
    },
    { status: 201 }
  );
}
