import { NextResponse } from "next/server";
import ddb, { TABLE_NAME } from "@/lib/db";
import {
  DeleteCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { getViewUrl } from "@/lib/s3";
import {
  AccountLedgerEntry,
  computeAccountBalance,
  LedgerKind,
} from "@/lib/accounts";

// Turn a raw GSI1 row (a projected rent payment or a transfer row) into the
// normalised ledger shape the UI renders.
function toLedgerEntry(
  e: Record<string, unknown>,
  screenshotUrl: string | null
): AccountLedgerEntry {
  const kind: LedgerKind =
    (e.kind as LedgerKind) || (e.paymentId ? "payment" : "transfer_out");

  // Rent payments and deposit movements all carry customer context. Pick the
  // right id/date for each since they're stored under different attributes.
  if (kind === "payment" || kind === "deposit" || kind === "deposit_refund") {
    const id =
      (e.paymentId as string) ||
      (e.depositId as string) ||
      (e.refundId as string);
    const date = (e.paidOn as string) || (e.date as string);
    return {
      id,
      kind,
      date,
      amount: (e.amount as number) || 0,
      note: (e.note as string) || null,
      screenshot_url: screenshotUrl,
      customer_id: (e.customerId as string) || null,
      customer_name: (e.customerName as string) || null,
      rental_id: (e.rentalId as string) || null,
      counterparty_id: null,
      counterparty_name: null,
      receipt_id: (e.receiptId as string) || null,
      created_at: e.createdAt as string,
    };
  }

  // Withdrawal — money out for an expense; no customer, no counterparty.
  if (kind === "withdrawal") {
    return {
      id: e.withdrawalId as string,
      kind,
      date: e.date as string,
      amount: (e.amount as number) || 0,
      note: (e.note as string) || null,
      screenshot_url: screenshotUrl,
      customer_id: null,
      customer_name: null,
      rental_id: null,
      counterparty_id: null,
      counterparty_name: null,
      receipt_id: null,
      created_at: e.createdAt as string,
    };
  }

  // Transfer row — the counterparty is whichever side isn't this account.
  const fromId = (e.fromAccountId as string) || null;
  const toId = (e.toAccountId as string) || null;
  const isOut = kind === "transfer_out";
  return {
    id: e.transferId as string,
    kind,
    date: e.date as string,
    amount: (e.amount as number) || 0,
    note: (e.note as string) || null,
    screenshot_url: screenshotUrl,
    customer_id: null,
    customer_name: null,
    rental_id: null,
    counterparty_id: isOut ? toId : fromId,
    counterparty_name:
      (isOut ? (e.toAccountName as string) : (e.fromAccountName as string)) ||
      null,
    receipt_id: null,
    created_at: e.createdAt as string,
  };
}

// GET /api/accounts/<id> — profile + full ledger in chronological order with
// signed screenshot URLs, plus rolled-up totals.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const profileRes = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `ACCOUNT#${id}`, SK: "PROFILE" },
    })
  );
  if (!profileRes.Item) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Ascending GSI1SK (date#id) gives chronological order so a running balance
  // reads top-to-bottom.
  const ledgerRes = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :pk",
      ExpressionAttributeValues: { ":pk": `ACCOUNT#${id}` },
      ScanIndexForward: true,
    })
  );

  const entries = await Promise.all(
    (ledgerRes.Items || []).map(async (e) => {
      const key = e.screenshotS3Key as string | undefined;
      const url = key ? await getViewUrl(key) : null;
      return toLedgerEntry(e, url);
    })
  );

  const totals = computeAccountBalance(entries);

  return NextResponse.json({
    id: profileRes.Item.accountId,
    name: profileRes.Item.name,
    created_at: profileRes.Item.createdAt,
    entries,
    ...totals,
  });
}

// PATCH /api/accounts/<id> — rename. Historical ledger rows keep the account
// name snapshotted at write time, so this only affects the profile going
// forward.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await req.json()) as { name?: string };
  const name = (body.name || "").trim();
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  try {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { PK: `ACCOUNT#${id}`, SK: "PROFILE" },
        UpdateExpression: "SET #n = :n, GSI1SK = :sk",
        ExpressionAttributeNames: { "#n": "name" },
        ExpressionAttributeValues: { ":n": name, ":sk": name.toLowerCase() },
        ConditionExpression: "attribute_exists(PK)",
      })
    );
  } catch (err: unknown) {
    if (
      typeof err === "object" &&
      err !== null &&
      "name" in err &&
      (err as { name: string }).name === "ConditionalCheckFailedException"
    ) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }
    throw err;
  }

  return NextResponse.json({ ok: true });
}

// DELETE /api/accounts/<id> — only when the account has no ledger activity
// (no payments collected into it, no transfers touching it). Keeps cash
// history unambiguous.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const ledgerRes = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :pk",
      ExpressionAttributeValues: { ":pk": `ACCOUNT#${id}` },
      Limit: 1,
    })
  );

  if ((ledgerRes.Items || []).length > 0) {
    return NextResponse.json(
      {
        error:
          "Account has payments or transfers — reassign or remove them before deleting the account.",
      },
      { status: 409 }
    );
  }

  await ddb.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { PK: `ACCOUNT#${id}`, SK: "PROFILE" },
    })
  );

  return NextResponse.json({ ok: true });
}
