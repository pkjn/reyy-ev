import { NextResponse } from "next/server";
import ddb, { TABLE_NAME } from "@/lib/db";
import {
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { v4 as uuid } from "uuid";
import {
  isValidDateString,
  isValidRateUnit,
} from "@/lib/billing";
import { getUploadUrl } from "@/lib/s3";
import type { TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";

// GET /api/rentals — every rental, latest first.
export async function GET() {
  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :pk",
      ExpressionAttributeValues: { ":pk": "RENTALS" },
      ScanIndexForward: false,
    })
  );

  const rentals = (result.Items || []).map((item) => ({
    id: item.rentalId,
    customer_id: item.customerId,
    customer_name: item.customerName,
    scooty_label: item.scootyLabel,
    start_date: item.startDate,
    end_date: item.endDate || null,
    rate: item.rate,
    rate_unit: item.rateUnit,
    created_at: item.createdAt,
  }));

  return NextResponse.json(rentals);
}

// POST /api/rentals
// Writes the rental record + a global RENTALID#<id> uniqueness marker in one
// transaction. customerName is denormalised onto the rental so the listing
// endpoint doesn't have to fan out to fetch each customer.
export async function POST(req: Request) {
  const body = (await req.json()) as {
    customer_id?: string;
    customer_name?: string;
    scooty_label?: string;
    start_date?: string;
    rate?: number;
    rate_unit?: string;
    security_deposit?: number;
    refundable_deposit?: number;
    deposit_collected?: number;
    deposit_account?: string;
    advance_payment?: number;
    advance_account?: string;
    advance_screenshot_filename?: string;
    advance_screenshot_type?: string;
    notes?: string;
  };

  const customerId = (body.customer_id || "").trim();
  const scootyLabel = (body.scooty_label || "").trim();
  const startDate = (body.start_date || "").trim();

  if (!customerId) {
    return NextResponse.json({ error: "customer_id is required" }, { status: 400 });
  }
  if (!scootyLabel) {
    return NextResponse.json({ error: "scooty_label is required" }, { status: 400 });
  }
  if (!isValidDateString(startDate)) {
    return NextResponse.json(
      { error: "start_date must be YYYY-MM-DD" },
      { status: 400 }
    );
  }
  if (typeof body.rate !== "number" || !(body.rate >= 0)) {
    return NextResponse.json(
      { error: "rate must be a non-negative number" },
      { status: 400 }
    );
  }
  if (!isValidRateUnit(body.rate_unit)) {
    return NextResponse.json(
      { error: "rate_unit must be day | week | month" },
      { status: 400 }
    );
  }
  const securityDeposit =
    typeof body.security_deposit === "number" ? body.security_deposit : 0;
  const refundableDeposit =
    typeof body.refundable_deposit === "number" ? body.refundable_deposit : 0;
  if (securityDeposit < 0 || refundableDeposit < 0) {
    return NextResponse.json(
      { error: "deposit amounts must be non-negative" },
      { status: 400 }
    );
  }
  if (refundableDeposit > securityDeposit) {
    return NextResponse.json(
      { error: "refundable_deposit cannot exceed security_deposit" },
      { status: 400 }
    );
  }
  // securityDeposit is the agreed *target*; depositCollected is how much of it
  // is actually taken now (the rest comes later as installments). When the
  // field is omitted we collect the full target — preserving the original
  // "full deposit up front" behaviour for older clients.
  const depositCollected =
    typeof body.deposit_collected === "number"
      ? body.deposit_collected
      : securityDeposit;
  if (depositCollected < 0 || depositCollected > securityDeposit) {
    return NextResponse.json(
      { error: "deposit_collected must be between 0 and security_deposit" },
      { status: 400 }
    );
  }
  const advancePayment =
    typeof body.advance_payment === "number" ? body.advance_payment : 0;
  if (advancePayment < 0) {
    return NextResponse.json(
      { error: "advance_payment must be non-negative" },
      { status: 400 }
    );
  }
  const advanceAccount = (body.advance_account || "").trim();
  if (advancePayment > 0 && !advanceAccount) {
    return NextResponse.json(
      { error: "advance_account is required when advance_payment > 0" },
      { status: 400 }
    );
  }
  const depositAccount = (body.deposit_account || "").trim();
  if (depositCollected > 0 && !depositAccount) {
    return NextResponse.json(
      { error: "deposit_account is required when deposit_collected > 0" },
      { status: 400 }
    );
  }

  const customerRes = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `CUSTOMER#${customerId}`, SK: "PROFILE" },
    })
  );
  if (!customerRes.Item) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }
  const customerName =
    (body.customer_name || (customerRes.Item.name as string)).trim();

  // Resolve the deposit account up front so a bad id fails before we write.
  let depositAccountName = "";
  if (depositCollected > 0) {
    const depAcctRes = await ddb.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: `ACCOUNT#${depositAccount}`, SK: "PROFILE" },
      })
    );
    if (!depAcctRes.Item) {
      return NextResponse.json(
        { error: "deposit_account not found" },
        { status: 404 }
      );
    }
    depositAccountName = depAcctRes.Item.name as string;
  }

  const rentalId = uuid();
  const now = new Date().toISOString();
  const notes = (body.notes || "").trim();

  // When a deposit and start rent are collected together (one real payment,
  // one screenshot), tie their two ledger rows with a shared receipt id so the
  // UI can present them as a single combined line.
  const startReceiptId =
    depositCollected > 0 && advancePayment > 0 ? uuid() : undefined;

  const transactItems: NonNullable<
    TransactWriteCommandInput["TransactItems"]
  > = [
    {
      Put: {
        TableName: TABLE_NAME,
        Item: {
          PK: `CUSTOMER#${customerId}`,
          SK: `RENTAL#${rentalId}`,
          GSI1PK: "RENTALS",
          GSI1SK: `${now}#${rentalId}`,
          rentalId,
          customerId,
          customerName,
          scootyLabel,
          startDate,
          rate: body.rate,
          rateUnit: body.rate_unit,
          securityDeposit: securityDeposit || undefined,
          refundableDeposit: refundableDeposit || undefined,
          notes: notes || undefined,
          createdAt: now,
        },
        ConditionExpression: "attribute_not_exists(SK)",
      },
    },
    {
      Put: {
        TableName: TABLE_NAME,
        Item: {
          PK: `RENTALID#${rentalId}`,
          SK: "UNIQUE",
          rentalId,
          customerId,
          createdAt: now,
        },
        ConditionExpression: "attribute_not_exists(PK)",
      },
    },
  ];

  // Record whatever deposit is collected now as cash into its account. The
  // rental's securityDeposit/refundableDeposit are the agreed *targets*; a
  // deposit may be collected in installments, so each collection is its own
  // row (SK=DEPOSIT#<rentalId>#<depositId>) projected into the account ledger
  // via GSI1. The refundable part is debited back out via a refund on return.
  if (depositCollected > 0) {
    const depositId = uuid();
    transactItems.push({
      Put: {
        TableName: TABLE_NAME,
        Item: {
          PK: `CUSTOMER#${customerId}`,
          SK: `DEPOSIT#${rentalId}#${depositId}`,
          GSI1PK: `ACCOUNT#${depositAccount}`,
          GSI1SK: `${startDate}#${depositId}`,
          kind: "deposit",
          depositId,
          receiptId: startReceiptId,
          rentalId,
          customerId,
          customerName,
          amount: depositCollected,
          date: startDate,
          account: depositAccount,
          accountName: depositAccountName,
          note: "Security deposit at rental start",
          createdAt: now,
        },
        ConditionExpression: "attribute_not_exists(SK)",
      },
    });
  }

  // Tack on the advance payment in the same transaction so the rental and the
  // first payment land atomically — no orphaned rental if the second write
  // fails, no payment-without-rental if the first does.
  let advanceScreenshotUploadUrl: string | undefined;
  if (advancePayment > 0) {
    const accountRes = await ddb.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: `ACCOUNT#${advanceAccount}`, SK: "PROFILE" },
      })
    );
    if (!accountRes.Item) {
      return NextResponse.json(
        { error: "advance_account not found" },
        { status: 404 }
      );
    }
    const advanceAccountName = accountRes.Item.name as string;
    const paymentId = uuid();
    const screenshotFilename = (body.advance_screenshot_filename || "").trim();
    const screenshotType = (body.advance_screenshot_type || "").trim();
    let screenshotS3Key: string | undefined;
    if (screenshotFilename && screenshotType) {
      const ext = screenshotFilename.includes(".")
        ? screenshotFilename.substring(screenshotFilename.lastIndexOf("."))
        : "";
      screenshotS3Key = `payments/${customerId}/${rentalId}/${paymentId}${ext}`;
      advanceScreenshotUploadUrl = await getUploadUrl(
        screenshotS3Key,
        screenshotType
      );
    }
    transactItems.push({
      Put: {
        TableName: TABLE_NAME,
        Item: {
          PK: `CUSTOMER#${customerId}`,
          SK: `PAYMENT#${rentalId}#${startDate}#${paymentId}`,
          // Projected into the receiving account's ledger via GSI1.
          GSI1PK: `ACCOUNT#${advanceAccount}`,
          GSI1SK: `${startDate}#${paymentId}`,
          kind: "payment",
          paymentId,
          receiptId: startReceiptId,
          rentalId,
          customerId,
          customerName,
          amount: advancePayment,
          paidOn: startDate,
          account: advanceAccount,
          accountName: advanceAccountName,
          note: "Advance at rental start",
          screenshotS3Key,
          createdAt: now,
        },
      },
    });
  }

  await ddb.send(new TransactWriteCommand({ TransactItems: transactItems }));

  return NextResponse.json(
    {
      id: rentalId,
      customer_id: customerId,
      customer_name: customerName,
      scooty_label: scootyLabel,
      start_date: startDate,
      rate: body.rate,
      rate_unit: body.rate_unit,
      security_deposit: securityDeposit,
      refundable_deposit: refundableDeposit,
      deposit_collected: depositCollected,
      advance_payment: advancePayment,
      advance_screenshot_upload_url: advanceScreenshotUploadUrl || null,
      notes: notes || null,
      created_at: now,
    },
    { status: 201 }
  );
}
