import { NextResponse } from "next/server";
import ddb, { TABLE_NAME } from "@/lib/db";
import { QueryCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { deleteObject } from "@/lib/s3";

// DELETE /api/accounts/<id>/withdrawals/<withdrawalId>
// The SK carries the date, which we don't know from the URL, so locate the
// row by the WITHDRAWAL# prefix and filter on withdrawalId.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; withdrawalId: string }> }
) {
  const { id: accountId, withdrawalId } = await params;

  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      FilterExpression: "withdrawalId = :wid",
      ExpressionAttributeValues: {
        ":pk": `ACCOUNT#${accountId}`,
        ":sk": "WITHDRAWAL#",
        ":wid": withdrawalId,
      },
    })
  );
  const item = res.Items?.[0];
  if (!item) {
    return NextResponse.json({ error: "Withdrawal not found" }, { status: 404 });
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
