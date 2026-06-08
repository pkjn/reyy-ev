import { NextResponse } from "next/server";
import ddb, { TABLE_NAME } from "@/lib/db";
import {
  GetCommand,
  QueryCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import { deleteObject } from "@/lib/s3";

// DELETE /api/rentals/<rentalId>/deposits/<depositId>
// Removes a single security-deposit collection (installment) and any screenshot.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; depositId: string }> }
) {
  const { id: rentalId, depositId } = await params;
  const url = new URL(req.url);
  let customerId = url.searchParams.get("customer_id") || "";

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

  // The deposit SK is either DEPOSIT#<rid> (legacy single row) or
  // DEPOSIT#<rid>#<depositId> (installments). The no-trailing-# prefix matches
  // both, and rentalIds are fixed-length UUIDs so it can't bleed into another
  // rental. We then pick the row by depositId.
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      FilterExpression: "depositId = :did",
      ExpressionAttributeValues: {
        ":pk": `CUSTOMER#${customerId}`,
        ":sk": `DEPOSIT#${rentalId}`,
        ":did": depositId,
      },
    })
  );
  const item = res.Items?.[0];
  if (!item) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (typeof item.screenshotS3Key === "string") {
    await deleteObject(item.screenshotS3Key);
  }

  await ddb.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { PK: item.PK as string, SK: item.SK as string },
    })
  );

  return NextResponse.json({ ok: true });
}
