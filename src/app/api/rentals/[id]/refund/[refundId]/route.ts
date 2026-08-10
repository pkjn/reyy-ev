import { NextResponse } from "next/server";
import ddb, { TABLE_NAME } from "@/lib/db";
import { GetCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { deleteObject } from "@/lib/s3";

// DELETE /api/rentals/<rentalId>/refund/<refundId>?customer_id=
// Removes a deposit refund and its screenshot. The SK is fully known
// (DEPOSITREFUND#<rentalId>#<refundId>), so a direct get/delete suffices.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; refundId: string }> }
) {
  const { id: rentalId, refundId } = await params;
  const url = new URL(req.url);
  let customerId = (url.searchParams.get("customer_id") || "").trim();

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
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const key = {
    PK: `CUSTOMER#${customerId}`,
    SK: `DEPOSITREFUND#${rentalId}#${refundId}`,
  };

  const res = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: key }));
  if (!res.Item) {
    return NextResponse.json({ error: "Refund not found" }, { status: 404 });
  }

  if (typeof res.Item.screenshotS3Key === "string") {
    await deleteObject(res.Item.screenshotS3Key);
  }
  await ddb.send(new DeleteCommand({ TableName: TABLE_NAME, Key: key }));

  return NextResponse.json({ ok: true });
}
