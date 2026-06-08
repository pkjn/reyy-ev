import { NextResponse } from "next/server";
import ddb, { TABLE_NAME } from "@/lib/db";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { v4 as uuid } from "uuid";
import { isValidDateString } from "@/lib/billing";
import { getUploadUrl } from "@/lib/s3";

// POST /api/accounts/<id>/withdrawals
// Body: { amount, date, note?, screenshot_filename?, screenshot_type? }
// Records money leaving the account for an expense (referral bonus, etc.) — a
// debit not tied to any customer or other account. Lives under the account
// partition and surfaces in its ledger via GSI1.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: accountId } = await params;
  const body = (await req.json()) as {
    amount?: number;
    date?: string;
    note?: string;
    screenshot_filename?: string;
    screenshot_type?: string;
  };

  if (typeof body.amount !== "number" || !(body.amount > 0)) {
    return NextResponse.json(
      { error: "amount must be a positive number" },
      { status: 400 }
    );
  }
  const date = (body.date || "").trim();
  if (!isValidDateString(date)) {
    return NextResponse.json(
      { error: "date must be YYYY-MM-DD" },
      { status: 400 }
    );
  }

  const accountRes = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `ACCOUNT#${accountId}`, SK: "PROFILE" },
    })
  );
  if (!accountRes.Item) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }
  const accountName = accountRes.Item.name as string;

  const withdrawalId = uuid();
  const now = new Date().toISOString();
  const note = (body.note || "").trim();

  let screenshotS3Key: string | undefined;
  let screenshotUploadUrl: string | undefined;
  const screenshotFilename = (body.screenshot_filename || "").trim();
  const screenshotType = (body.screenshot_type || "").trim();
  if (screenshotFilename && screenshotType) {
    const ext = screenshotFilename.includes(".")
      ? screenshotFilename.substring(screenshotFilename.lastIndexOf("."))
      : "";
    screenshotS3Key = `withdrawals/${accountId}/${withdrawalId}${ext}`;
    screenshotUploadUrl = await getUploadUrl(screenshotS3Key, screenshotType);
  }

  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `ACCOUNT#${accountId}`,
        SK: `WITHDRAWAL#${date}#${withdrawalId}`,
        GSI1PK: `ACCOUNT#${accountId}`,
        GSI1SK: `${date}#${withdrawalId}`,
        kind: "withdrawal",
        withdrawalId,
        accountId,
        accountName,
        amount: body.amount,
        date,
        note: note || undefined,
        screenshotS3Key,
        createdAt: now,
      },
    })
  );

  return NextResponse.json(
    {
      id: withdrawalId,
      account_id: accountId,
      amount: body.amount,
      date,
      note: note || null,
      screenshot_upload_url: screenshotUploadUrl || null,
      created_at: now,
    },
    { status: 201 }
  );
}
