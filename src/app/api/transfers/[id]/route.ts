import { NextResponse } from "next/server";
import ddb, { TABLE_NAME } from "@/lib/db";
import { QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { deleteObject } from "@/lib/s3";

// Locate a transfer's row under one account. The SK carries the date which we
// don't know from the URL, so query the TRANSFER# prefix and filter on the
// shared transferId.
async function findRow(accountId: string, transferId: string) {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      FilterExpression: "transferId = :tid",
      ExpressionAttributeValues: {
        ":pk": `ACCOUNT#${accountId}`,
        ":sk": "TRANSFER#",
        ":tid": transferId,
      },
    })
  );
  return res.Items?.[0];
}

// DELETE /api/transfers/<id>?from_account_id=&to_account_id=
// Removes both ledger rows of a transfer plus its screenshot. The two account
// ids come from the ledger entry the client is acting on.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: transferId } = await params;
  const url = new URL(req.url);
  const fromId = (url.searchParams.get("from_account_id") || "").trim();
  const toId = (url.searchParams.get("to_account_id") || "").trim();

  if (!fromId || !toId) {
    return NextResponse.json(
      { error: "from_account_id and to_account_id are required" },
      { status: 400 }
    );
  }

  const [fromRow, toRow] = await Promise.all([
    findRow(fromId, transferId),
    findRow(toId, transferId),
  ]);

  if (!fromRow && !toRow) {
    return NextResponse.json({ error: "Transfer not found" }, { status: 404 });
  }

  const screenshotKey = (fromRow?.screenshotS3Key ||
    toRow?.screenshotS3Key) as string | undefined;
  if (screenshotKey) {
    await deleteObject(screenshotKey);
  }

  const deletes = [fromRow, toRow]
    .filter((r): r is NonNullable<typeof r> => !!r)
    .map((r) => ({
      Delete: {
        TableName: TABLE_NAME,
        Key: { PK: r.PK as string, SK: r.SK as string },
      },
    }));

  await ddb.send(new TransactWriteCommand({ TransactItems: deletes }));

  return NextResponse.json({ ok: true });
}
