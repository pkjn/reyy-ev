import { NextResponse } from "next/server";
import ddb, { TABLE_NAME } from "@/lib/db";
import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { v4 as uuid } from "uuid";
import { isValidDateString } from "@/lib/billing";
import { getUploadUrl } from "@/lib/s3";

// POST /api/rentals/<rentalId>/refund
// Body: { customer_id, amount, date, account, note?, screenshot_filename?,
//         screenshot_type? }
// Records a deposit refund — money leaving an account back to the customer (a
// debit). Amount is free-form so partial keeps / forfeits are possible; the
// UI defaults it to the rental's refundable deposit. Projected into the
// account ledger via GSI1=ACCOUNT#<id>.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: rentalId } = await params;
  const body = (await req.json()) as {
    customer_id?: string;
    amount?: number;
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

  // You can't refund money you never received: cap the refund at the deposit
  // actually collected so far, net of what's already been refunded. (The
  // deposit may have been collected in installments — sum them all.)
  const [depositsRes, refundsRes] = await Promise.all([
    ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: {
          ":pk": `CUSTOMER#${customerId}`,
          ":sk": `DEPOSIT#${rentalId}`,
        },
      })
    ),
    ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: {
          ":pk": `CUSTOMER#${customerId}`,
          ":sk": `DEPOSITREFUND#${rentalId}#`,
        },
      })
    ),
  ]);
  const collected = (depositsRes.Items || []).reduce(
    (s, d) => s + ((d.amount as number) || 0),
    0
  );
  const alreadyRefunded = (refundsRes.Items || []).reduce(
    (s, r) => s + ((r.amount as number) || 0),
    0
  );
  const refundable = collected - alreadyRefunded;
  if (body.amount > refundable) {
    return NextResponse.json(
      {
        error: `Cannot refund ₹${body.amount}. Only ₹${refundable} is available (₹${collected} collected, ₹${alreadyRefunded} already refunded).`,
      },
      { status: 400 }
    );
  }

  const refundId = uuid();
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
    screenshotS3Key = `refunds/${customerId}/${rentalId}/${refundId}${ext}`;
    screenshotUploadUrl = await getUploadUrl(screenshotS3Key, screenshotType);
  }

  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `CUSTOMER#${customerId}`,
        SK: `DEPOSITREFUND#${rentalId}#${refundId}`,
        GSI1PK: `ACCOUNT#${account}`,
        GSI1SK: `${date}#${refundId}`,
        kind: "deposit_refund",
        refundId,
        rentalId,
        customerId,
        customerName,
        amount: body.amount,
        date,
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
      id: refundId,
      rental_id: rentalId,
      customer_id: customerId,
      amount: body.amount,
      date,
      account,
      note: note || null,
      screenshot_upload_url: screenshotUploadUrl || null,
      created_at: now,
    },
    { status: 201 }
  );
}
