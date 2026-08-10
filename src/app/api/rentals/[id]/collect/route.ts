import { NextResponse } from "next/server";
import ddb, { TABLE_NAME } from "@/lib/db";
import { GetCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";
import { v4 as uuid } from "uuid";
import { isValidDateString } from "@/lib/billing";
import { getUploadUrl } from "@/lib/s3";

// POST /api/rentals/<rentalId>/collect
// One collection that can carry rent and/or a security-deposit installment.
// Body: { customer_id?, rent_amount?, deposit_amount?, date, account, note?,
//         screenshot_filename?, screenshot_type? }
//
// When both rent and deposit are present they're written in a single
// transaction sharing one receiptId (so the UI groups them as one "Collected"
// line with a single screenshot), since they came from one real transfer.
// When only one is present a single row is written. The screenshot rides on
// the rent payment row if there is one, else on the deposit row.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: rentalId } = await params;
  const body = (await req.json()) as {
    customer_id?: string;
    rent_amount?: number;
    deposit_amount?: number;
    date?: string;
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

  const rentAmount =
    typeof body.rent_amount === "number" ? body.rent_amount : 0;
  const depositAmount =
    typeof body.deposit_amount === "number" ? body.deposit_amount : 0;
  if (rentAmount < 0 || depositAmount < 0) {
    return NextResponse.json(
      { error: "amounts must be non-negative" },
      { status: 400 }
    );
  }
  if (rentAmount === 0 && depositAmount === 0) {
    return NextResponse.json(
      { error: "at least one of rent_amount or deposit_amount must be > 0" },
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
  const account = (body.account || "").trim();
  if (!account) {
    return NextResponse.json({ error: "account is required" }, { status: 400 });
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

  const now = new Date().toISOString();
  const note = (body.note || "").trim();
  // Share a receipt only when this collection bundles both kinds.
  const receiptId =
    rentAmount > 0 && depositAmount > 0 ? uuid() : undefined;

  // The (optional) single screenshot for this real transfer. It rides on the
  // rent payment when there is one, otherwise on the deposit row.
  const screenshotFilename = (body.screenshot_filename || "").trim();
  const screenshotType = (body.screenshot_type || "").trim();
  const screenshotExt =
    screenshotFilename && screenshotFilename.includes(".")
      ? screenshotFilename.substring(screenshotFilename.lastIndexOf("."))
      : "";

  const paymentId = rentAmount > 0 ? uuid() : undefined;
  const depositId = depositAmount > 0 ? uuid() : undefined;

  let screenshotS3Key: string | undefined;
  if (screenshotFilename && screenshotType) {
    screenshotS3Key =
      rentAmount > 0
        ? `payments/${customerId}/${rentalId}/${paymentId}${screenshotExt}`
        : `deposits/${customerId}/${rentalId}/${depositId}${screenshotExt}`;
  }
  const screenshotUploadUrl =
    screenshotS3Key && screenshotType
      ? await getUploadUrl(screenshotS3Key, screenshotType)
      : undefined;

  const transactItems: NonNullable<
    TransactWriteCommandInput["TransactItems"]
  > = [];

  if (rentAmount > 0) {
    transactItems.push({
      Put: {
        TableName: TABLE_NAME,
        Item: {
          PK: `CUSTOMER#${customerId}`,
          SK: `PAYMENT#${rentalId}#${date}#${paymentId}`,
          GSI1PK: `ACCOUNT#${account}`,
          GSI1SK: `${date}#${paymentId}`,
          kind: "payment",
          paymentId,
          receiptId,
          rentalId,
          customerId,
          customerName,
          amount: rentAmount,
          paidOn: date,
          account,
          accountName,
          note: note || undefined,
          screenshotS3Key,
          createdAt: now,
        },
      },
    });
  }

  if (depositAmount > 0) {
    transactItems.push({
      Put: {
        TableName: TABLE_NAME,
        Item: {
          PK: `CUSTOMER#${customerId}`,
          SK: `DEPOSIT#${rentalId}#${depositId}`,
          GSI1PK: `ACCOUNT#${account}`,
          GSI1SK: `${date}#${depositId}`,
          kind: "deposit",
          depositId,
          receiptId,
          rentalId,
          customerId,
          customerName,
          amount: depositAmount,
          date,
          account,
          accountName,
          // Only the rent row carries the screenshot when both are present.
          screenshotS3Key: rentAmount > 0 ? undefined : screenshotS3Key,
          note: note || "Security deposit installment",
          createdAt: now,
        },
      },
    });
  }

  await ddb.send(new TransactWriteCommand({ TransactItems: transactItems }));

  return NextResponse.json(
    {
      rental_id: rentalId,
      customer_id: customerId,
      rent_amount: rentAmount,
      deposit_amount: depositAmount,
      date,
      account,
      payment_id: paymentId || null,
      deposit_id: depositId || null,
      receipt_id: receiptId || null,
      screenshot_upload_url: screenshotUploadUrl || null,
      created_at: now,
    },
    { status: 201 }
  );
}
