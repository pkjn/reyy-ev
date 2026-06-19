import { NextResponse } from "next/server";
import ddb, { TABLE_NAME } from "@/lib/db";
import {
  GetCommand,
  QueryCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import { deleteObject } from "@/lib/s3";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; paymentId: string }> }
) {
  const { id: rentalId, paymentId } = await params;
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

  // The payment SK contains the paid-on date which we don't know — query by
  // prefix and filter on paymentId.
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      FilterExpression: "paymentId = :pid",
      ExpressionAttributeValues: {
        ":pk": `CUSTOMER#${customerId}`,
        ":sk": `PAYMENT#${rentalId}#`,
        ":pid": paymentId,
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
