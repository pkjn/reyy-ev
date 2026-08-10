import { NextResponse } from "next/server";
import ddb, { TABLE_NAME } from "@/lib/db";
import {
  GetCommand,
  PutCommand,
  QueryCommand,
  type QueryCommandInput,
} from "@aws-sdk/lib-dynamodb";
import { v4 as uuid } from "uuid";

// ONE-TIME MIGRATION — back-fill deposit ledger entries for rentals created
// before deposits were tracked as account cash. Each such rental has a
// securityDeposit field but no DEPOSIT# row and no account. We credit the
// deposit to the SAME account as that rental's rent payment (deposit + rent
// were collected together at start). Rentals with no rent payment we can map
// to an account are reported as unmapped — never guessed.
//
//   GET  → dry run: report what would change, mutate nothing.
//   POST → apply.
//
// Safe to re-run: a rental that already has a DEPOSIT# row is skipped.
// Run the payments migration first so payments carry account ids. Delete this
// route once you've run it.

type Item = Record<string, unknown>;

async function queryAll(
  params: Omit<QueryCommandInput, "ExclusiveStartKey">
): Promise<Item[]> {
  const items: Item[] = [];
  let ExclusiveStartKey: Item | undefined;
  do {
    const res = await ddb.send(
      new QueryCommand({ ...params, ExclusiveStartKey })
    );
    items.push(...(res.Items || []));
    ExclusiveStartKey = res.LastEvaluatedKey as Item | undefined;
  } while (ExclusiveStartKey);
  return items;
}

// Pick the account a rental's deposit should land in: the rent payment dated
// on the rental's start day, else the earliest payment. Only payments that
// already carry an account id qualify.
function resolveAccount(
  payments: Item[],
  startDate: string
): { id: string; name: string } | null {
  const withAccount = payments.filter((p) => (p.account as string) || "");
  if (withAccount.length === 0) return null;
  const startDay = withAccount.find((p) => p.paidOn === startDate);
  const chosen =
    startDay ||
    [...withAccount].sort((a, b) =>
      (a.paidOn as string) < (b.paidOn as string) ? -1 : 1
    )[0];
  return {
    id: chosen.account as string,
    name: (chosen.accountName as string) || "",
  };
}

async function run(apply: boolean) {
  const rentals = await queryAll({
    TableName: TABLE_NAME,
    IndexName: "GSI1",
    KeyConditionExpression: "GSI1PK = :pk",
    ExpressionAttributeValues: { ":pk": "RENTALS" },
  });

  let migrated = 0;
  let skipped = 0;
  const unmapped: { rentalId: string; reason: string }[] = [];
  const perAccount = new Map<string, number>();

  for (const r of rentals) {
    const securityDeposit = (r.securityDeposit as number) || 0;
    if (securityDeposit <= 0) continue;

    const rentalId = r.rentalId as string;
    const customerId = r.customerId as string;

    // Idempotency: skip rentals that already have a deposit row.
    const existing = await ddb.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: `CUSTOMER#${customerId}`, SK: `DEPOSIT#${rentalId}` },
      })
    );
    if (existing.Item) {
      skipped++;
      continue;
    }

    const payments = await queryAll({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": `CUSTOMER#${customerId}`,
        ":sk": `PAYMENT#${rentalId}#`,
      },
    });

    const startDate = r.startDate as string;
    const acct = resolveAccount(payments, startDate);
    if (!acct) {
      unmapped.push({
        rentalId,
        reason: "no rent payment with an account to infer the deposit account from",
      });
      continue;
    }

    perAccount.set(acct.name || acct.id, (perAccount.get(acct.name || acct.id) || 0) + 1);
    migrated++;

    if (apply) {
      const depositId = uuid();
      await ddb.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            PK: `CUSTOMER#${customerId}`,
            SK: `DEPOSIT#${rentalId}`,
            GSI1PK: `ACCOUNT#${acct.id}`,
            GSI1SK: `${startDate}#${depositId}`,
            kind: "deposit",
            depositId,
            rentalId,
            customerId,
            customerName: (r.customerName as string) || undefined,
            amount: securityDeposit,
            refundableDeposit: (r.refundableDeposit as number) || undefined,
            date: startDate,
            account: acct.id,
            accountName: acct.name,
            note: "Security deposit at rental start (migrated)",
            createdAt: new Date().toISOString(),
          },
          ConditionExpression: "attribute_not_exists(SK)",
        })
      );
    }
  }

  return {
    mode: apply ? "applied" : "dry-run",
    deposits_migrated: migrated,
    already_done_skipped: skipped,
    per_account: Object.fromEntries(perAccount),
    unmapped,
    ...(apply
      ? {}
      : {
          note: "Nothing was changed. Re-run with POST to apply. Run the payments migration first so payments carry account ids.",
        }),
  };
}

export async function GET() {
  return NextResponse.json(await run(false));
}

export async function POST() {
  return NextResponse.json(await run(true));
}
