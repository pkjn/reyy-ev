import { NextResponse } from "next/server";
import ddb, { TABLE_NAME } from "@/lib/db";
import { PutCommand } from "@aws-sdk/lib-dynamodb";

// POST /api/rentals/[id]/pull
// Writes a PULL_REQUEST marker for a given rental ID to trigger an on-demand location report from the driver's app.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: rentalId } = await params;

  if (!rentalId) {
    return NextResponse.json(
      { error: "rentalId is required" },
      { status: 400 }
    );
  }

  const pk = `RENTALID#${rentalId}`;
  const sk = "PULL_REQUEST";

  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: pk,
        SK: sk,
        rentalId,
        requested: true,
        updatedAt: new Date().toISOString(),
      },
    })
  );

  return NextResponse.json({ ok: true });
}
