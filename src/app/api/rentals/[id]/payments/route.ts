import { NextResponse } from "next/server";
import ddb, { TABLE_NAME } from "@/lib/db";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { v4 as uuid } from "uuid";
import { isValidDateString } from "@/lib/billing";
import { getUploadUrl } from "@/lib/s3";

// POST /api/rentals/<rentalId>/payments
// Body: { customer_id, amount, paid_on, account, note?, screenshot_filename?, screenshot_type? }
// If screenshot_filename is provided, the response includes screenshot_upload_url
// — a presigned PUT URL the client uploads to next. The s3Key is stamped on
// the payment record immediately; if upload fails, the user can re-attempt by
// deleting and re-creating the payment.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: rentalId } = await params;
  const body = (await req.json()) as {
    customer_id?: string;
    amount?: number;
    paid_on?: string;
    account?: string;
    note?: string;
    screenshot_filename?: string;
    screenshot_type?: string;
  };

  let customerId = (body.customer_id || "").trim();
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
    return NextResponse.json({ error: "Rental not found" }, { status: 404 });
  }

  if (typeof body.amount !== "number" || !(body.amount > 0)) {
    return NextResponse.json(
      { error: "amount must be a positive number" },
      { status: 400 }
    );
  }
  const paidOn = (body.paid_on || "").trim();
  if (!isValidDateString(paidOn)) {
    return NextResponse.json(
      { error: "paid_on must be YYYY-MM-DD" },
      { status: 400 }
    );
  }
  const account = (body.account || "").trim();
  if (!account) {
    return NextResponse.json(
      { error: "account is required" },
      { status: 400 }
    );
  }

  const [rentalRes, accountRes] = await Promise.all([
    ddb.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: `CUSTOMER#${customerId}`, SK: `RENTAL#${rentalId}` },
      })
    ),
    ddb.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: `ACCOUNT#${account}`, SK: "PROFILE" },
      })
    ),
  ]);
  if (!rentalRes.Item) {
    return NextResponse.json({ error: "Rental not found" }, { status: 404 });
  }
  if (!accountRes.Item) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }
  const accountName = accountRes.Item.name as string;
  const customerName = (rentalRes.Item.customerName as string) || undefined;

  const paymentId = uuid();
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
    screenshotS3Key = `payments/${customerId}/${rentalId}/${paymentId}${ext}`;
    screenshotUploadUrl = await getUploadUrl(screenshotS3Key, screenshotType);
  }

  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `CUSTOMER#${customerId}`,
        SK: `PAYMENT#${rentalId}#${paidOn}#${paymentId}`,
        // Projected into the receiving account's ledger via GSI1 so an
        // account balance is a single query.
        GSI1PK: `ACCOUNT#${account}`,
        GSI1SK: `${paidOn}#${paymentId}`,
        kind: "payment",
        paymentId,
        rentalId,
        customerId,
        customerName,
        amount: body.amount,
        paidOn,
        account,
        accountName,
        note: note || undefined,
        screenshotS3Key,
        createdAt: now,
      },
    })
  );

  return NextResponse.json(
    {
      id: paymentId,
      rental_id: rentalId,
      customer_id: customerId,
      amount: body.amount,
      paid_on: paidOn,
      account,
      note: note || null,
      screenshot_upload_url: screenshotUploadUrl || null,
      created_at: now,
    },
    { status: 201 }
  );
}
