import { NextResponse } from "next/server";
import ddb, { TABLE_NAME } from "@/lib/db";
import {
  PutCommand,
  QueryCommand,
  UpdateCommand,
  type QueryCommandInput,
} from "@aws-sdk/lib-dynamodb";
import { v4 as uuid } from "uuid";

// ONE-TIME MIGRATION — roll up payments written before accounts became
// first-class DDB rows. Such payments still carry the old hardcoded account
// string (e.g. "surbhi") and project under GSI1PK=RENTAL#<rid>. We repoint
// them at a real account (matched by name, created if missing), stamp
// kind/accountName/customerName, and move their GSI1 projection to
// ACCOUNT#<id> so they roll into balances and ledgers.
//
//   GET  → dry run: report what would change, mutate nothing.
//   POST → apply the changes.
//
// Safe to re-run: a migrated payment leaves the RENTAL#<rid> partition, so a
// second pass finds nothing left to do. Delete this route once you've run it.

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

function capitalize(s: string): string {
  return s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

async function run(apply: boolean) {
  // 1. Existing accounts, keyed by lowercased name.
  const accountRows = await queryAll({
    TableName: TABLE_NAME,
    IndexName: "GSI1",
    KeyConditionExpression: "GSI1PK = :pk",
    ExpressionAttributeValues: { ":pk": "ACCOUNTS" },
  });
  const accountsByName = new Map<string, { id: string; name: string }>();
  for (const a of accountRows) {
    accountsByName.set((a.name as string).toLowerCase(), {
      id: a.accountId as string,
      name: a.name as string,
    });
  }

  // Resolve an old account string to a real account, creating it on apply.
  const createdAccounts: string[] = [];
  async function resolveAccount(
    raw: string
  ): Promise<{ id: string; name: string } | null> {
    const key = raw.toLowerCase();
    const existing = accountsByName.get(key);
    if (existing) return existing;

    const name = capitalize(raw);
    if (apply) {
      const id = uuid();
      const now = new Date().toISOString();
      await ddb.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            PK: `ACCOUNT#${id}`,
            SK: "PROFILE",
            GSI1PK: "ACCOUNTS",
            GSI1SK: name.toLowerCase(),
            accountId: id,
            name,
            createdAt: now,
          },
        })
      );
      const created = { id, name };
      accountsByName.set(key, created);
      createdAccounts.push(name);
      return created;
    }
    // Dry run — pretend it exists so downstream counting works, but flag it.
    if (!createdAccounts.includes(name)) createdAccounts.push(name);
    const placeholder = { id: `(new) ${name}`, name };
    accountsByName.set(key, placeholder);
    return placeholder;
  }

  // 2. Every rental — carries customerName we denormalise onto payments.
  const rentals = await queryAll({
    TableName: TABLE_NAME,
    IndexName: "GSI1",
    KeyConditionExpression: "GSI1PK = :pk",
    ExpressionAttributeValues: { ":pk": "RENTALS" },
  });

  let migrated = 0;
  const unmapped: { paymentId: string; reason: string }[] = [];
  const perAccount = new Map<string, number>();

  for (const r of rentals) {
    const rid = r.rentalId as string;
    const customerName = (r.customerName as string) || undefined;

    // 3. Only the OLD payments still live under RENTAL#<rid>.
    const oldPayments = await queryAll({
      TableName: TABLE_NAME,
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :pk",
      ExpressionAttributeValues: { ":pk": `RENTAL#${rid}` },
    });

    for (const p of oldPayments) {
      const raw = ((p.account as string) || "").trim();
      const paymentId = (p.paymentId as string) || "(unknown)";
      if (!raw) {
        unmapped.push({ paymentId, reason: "payment has no account string" });
        continue;
      }
      const acct = await resolveAccount(raw);
      if (!acct) {
        unmapped.push({ paymentId, reason: `could not map "${raw}"` });
        continue;
      }

      perAccount.set(acct.name, (perAccount.get(acct.name) || 0) + 1);
      migrated++;

      if (apply) {
        const setParts = [
          "GSI1PK = :gpk",
          "GSI1SK = :gsk",
          "#kind = :kind",
          "#account = :account",
          "accountName = :accountName",
        ];
        const names: Record<string, string> = {
          "#kind": "kind",
          "#account": "account",
        };
        const values: Record<string, unknown> = {
          ":gpk": `ACCOUNT#${acct.id}`,
          ":gsk": `${p.paidOn as string}#${paymentId}`,
          ":kind": "payment",
          ":account": acct.id,
          ":accountName": acct.name,
        };
        if (customerName) {
          setParts.push("customerName = :customerName");
          values[":customerName"] = customerName;
        }
        await ddb.send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { PK: p.PK as string, SK: p.SK as string },
            UpdateExpression: "SET " + setParts.join(", "),
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
          })
        );
      }
    }
  }

  return {
    mode: apply ? "applied" : "dry-run",
    payments_found: migrated + unmapped.length,
    payments_migrated: migrated,
    accounts_created: createdAccounts,
    per_account: Object.fromEntries(perAccount),
    unmapped,
    ...(apply
      ? {}
      : {
          note: "Nothing was changed. Re-run with POST to apply. Accounts under accounts_created will be created on apply.",
        }),
  };
}

export async function GET() {
  return NextResponse.json(await run(false));
}

export async function POST() {
  return NextResponse.json(await run(true));
}
