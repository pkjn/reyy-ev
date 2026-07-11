import { NextResponse } from "next/server";
import ddb, { TABLE_NAME } from "@/lib/db";
import { DeleteCommand } from "@aws-sdk/lib-dynamodb";

// DELETE /api/vehicles/<id>/odometer/<readingId>?date=YYYY-MM-DD
// The reading's date is part of its sort key, so the client passes it back to
// address the row directly (no extra lookup).
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; readingId: string }> }
) {
  const { id, readingId } = await params;
  const date = new URL(req.url).searchParams.get("date");
  if (!date) {
    return NextResponse.json({ error: "date is required" }, { status: 400 });
  }

  await ddb.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { PK: `VEHICLE#${id}`, SK: `ODO#${date}#${readingId}` },
    })
  );

  return NextResponse.json({ ok: true });
}
