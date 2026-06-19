import { NextResponse } from "next/server";
import ddb, { TABLE_NAME } from "@/lib/db";
import { GetCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { v4 as uuid } from "uuid";
import { isValidDateString } from "@/lib/billing";
import { getUploadUrl } from "@/lib/s3";

// POST /api/transfers
// Body: { from_account_id, to_account_id, amount, date, note?,
//         screenshot_filename?, screenshot_type? }
// Records a manual money movement between two accounts as a pair of ledger
// rows — a `transfer_out` under the source and a `transfer_in` under the
// destination — written atomically so a transfer never lands half-recorded.
// Both rows share the same transferId and screenshot. If a screenshot
// filename is provided, the response carries a presigned PUT URL the client
// uploads to next.
export async function POST(req: Request) {
  const body = (await req.json()) as {
    from_account_id?: string;
    to_account_id?: string;
    amount?: number;
    date?: string;
    note?: string;
    screenshot_filename?: string;
    screenshot_type?: string;
  };

  const fromId = (body.from_account_id || "").trim();
  const toId = (body.to_account_id || "").trim();

  if (!fromId || !toId) {
    return NextResponse.json(
      { error: "from_account_id and to_account_id are required" },
      { status: 400 }
    );
  }
  if (fromId === toId) {
    return NextResponse.json(
      { error: "Cannot transfer to the same account" },
      { status: 400 }
    );
  }
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

  const [fromRes, toRes] = await Promise.all([
    ddb.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: `ACCOUNT#${fromId}`, SK: "PROFILE" },
      })
    ),
    ddb.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: `ACCOUNT#${toId}`, SK: "PROFILE" },
      })
    ),
  ]);
  if (!fromRes.Item) {
    return NextResponse.json(
      { error: "Source account not found" },
      { status: 404 }
    );
  }
  if (!toRes.Item) {
    return NextResponse.json(
      { error: "Destination account not found" },
      { status: 404 }
    );
  }
  const fromName = fromRes.Item.name as string;
  const toName = toRes.Item.name as string;

  const transferId = uuid();
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
    screenshotS3Key = `transfers/${transferId}${ext}`;
    screenshotUploadUrl = await getUploadUrl(screenshotS3Key, screenshotType);
  }

  const shared = {
    transferId,
    fromAccountId: fromId,
    fromAccountName: fromName,
    toAccountId: toId,
    toAccountName: toName,
    amount: body.amount,
    date,
    note: note || undefined,
    screenshotS3Key,
    createdAt: now,
  };

  await ddb.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: TABLE_NAME,
            Item: {
              PK: `ACCOUNT#${fromId}`,
              SK: `TRANSFER#${date}#${transferId}`,
              GSI1PK: `ACCOUNT#${fromId}`,
              GSI1SK: `${date}#${transferId}`,
              kind: "transfer_out",
              ...shared,
            },
          },
        },
        {
          Put: {
            TableName: TABLE_NAME,
            Item: {
              PK: `ACCOUNT#${toId}`,
              SK: `TRANSFER#${date}#${transferId}`,
              GSI1PK: `ACCOUNT#${toId}`,
              GSI1SK: `${date}#${transferId}`,
              kind: "transfer_in",
              ...shared,
            },
          },
        },
      ],
    })
  );

  return NextResponse.json(
    {
      id: transferId,
      from_account_id: fromId,
      to_account_id: toId,
      amount: body.amount,
      date,
      note: note || null,
      screenshot_upload_url: screenshotUploadUrl || null,
      created_at: now,
    },
    { status: 201 }
  );
}
