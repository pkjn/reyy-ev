import { NextResponse } from "next/server";
import ddb, { TABLE_NAME } from "@/lib/db";
import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { v4 as uuid } from "uuid";

// Roll an account's GSI1 partition into a single balance. The partition holds
// rent payments (projected in from CUSTOMER#…) plus transfer rows. Payments
// and transfers-in are credits; transfers-out are debits. Older payment rows
// written before `kind` was stamped are inferred from `paymentId`.
async function computeBalance(accountId: string): Promise<number> {
  const r = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :pk",
      ExpressionAttributeValues: { ":pk": `ACCOUNT#${accountId}` },
    })
  );
  let balance = 0;
  for (const e of r.Items || []) {
    const amt = (e.amount as number) || 0;
    const kind = (e.kind as string) || (e.paymentId ? "payment" : "");
    if (kind === "payment" || kind === "deposit" || kind === "transfer_in")
      balance += amt;
    else if (
      kind === "transfer_out" ||
      kind === "deposit_refund" ||
      kind === "withdrawal"
    )
      balance -= amt;
  }
  return balance;
}

// GET /api/accounts — every account with its current balance, alphabetical.
export async function GET() {
  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :pk",
      ExpressionAttributeValues: { ":pk": "ACCOUNTS" },
    })
  );
  const accounts = await Promise.all(
    (result.Items || []).map(async (a) => ({
      id: a.accountId as string,
      name: a.name as string,
      created_at: a.createdAt as string,
      // Non-cash accounts (credits/adjustments) track rent waived rather than
      // real money held, so they're excluded from the cash total on the client.
      non_cash: a.nonCash === true,
      balance: await computeBalance(a.accountId as string),
    }))
  );
  return NextResponse.json(accounts);
}

// POST /api/accounts — create a named account (Surbhi, Rajiv, bank, …).
export async function POST(req: Request) {
  const body = (await req.json()) as { name?: string; non_cash?: boolean };
  const name = (body.name || "").trim();
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const nonCash = body.non_cash === true;

  const id = uuid();
  const now = new Date().toISOString();

  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `ACCOUNT#${id}`,
        SK: "PROFILE",
        GSI1PK: "ACCOUNTS",
        // Lowercased name gives a stable alphabetical sort under GSI1.
        GSI1SK: name.toLowerCase(),
        accountId: id,
        name,
        // Only stamped when true; undefined is stripped by removeUndefinedValues.
        nonCash: nonCash || undefined,
        createdAt: now,
      },
    })
  );

  return NextResponse.json(
    { id, name, non_cash: nonCash, created_at: now },
    { status: 201 }
  );
}
