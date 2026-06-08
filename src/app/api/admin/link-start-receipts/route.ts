import { NextResponse } from "next/server";
import ddb, { TABLE_NAME } from "@/lib/db";
import {
  GetCommand,
  QueryCommand,
  UpdateCommand,
  type QueryCommandInput,
} from "@aws-sdk/lib-dynamodb";
import { v4 as uuid } from "uuid";

// ONE-TIME MIGRATION — link each rental's deposit and its start-rent payment
// ("Advance at rental start") with a shared receiptId, so combined collections
// recorded before receipts existed group into one screenshot-backed line.
//
//   GET  → dry run. POST → apply. Idempotent: deposits already linked are
// skipped. Run AFTER migrate-deposits. Delete this route once you've run it.

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

async function run(apply: boolean) {
  const rentals = await queryAll({
    TableName: TABLE_NAME,
    IndexName: "GSI1",
    KeyConditionExpression: "GSI1PK = :pk",
    ExpressionAttributeValues: { ":pk": "RENTALS" },
  });

  let linked = 0;
  let alreadyLinked = 0;
  let noDeposit = 0;
  let noAdvance = 0;

  for (const r of rentals) {
    const rentalId = r.rentalId as string;
    const customerId = r.customerId as string;

    const depositRes = await ddb.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: `CUSTOMER#${customerId}`, SK: `DEPOSIT#${rentalId}` },
      })
    );
    const deposit = depositRes.Item;
    if (!deposit) {
      noDeposit++;
      continue;
    }
    if (deposit.receiptId) {
      alreadyLinked++;
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
    // The start-rent payment is stamped with this note at rental creation.
    const advance =
      payments.find((p) => p.note === "Advance at rental start") ||
      payments.find((p) => p.paidOn === r.startDate);
    if (!advance) {
      noAdvance++;
      continue;
    }

    linked++;
    if (apply) {
      const receiptId = uuid();
      await Promise.all([
        ddb.send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { PK: deposit.PK as string, SK: deposit.SK as string },
            UpdateExpression: "SET receiptId = :r",
            ExpressionAttributeValues: { ":r": receiptId },
          })
        ),
        ddb.send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { PK: advance.PK as string, SK: advance.SK as string },
            UpdateExpression: "SET receiptId = :r",
            ExpressionAttributeValues: { ":r": receiptId },
          })
        ),
      ]);
    }
  }

  return {
    mode: apply ? "applied" : "dry-run",
    linked,
    already_linked_skipped: alreadyLinked,
    no_deposit_skipped: noDeposit,
    no_advance_payment_skipped: noAdvance,
    ...(apply
      ? {}
      : {
          note: "Nothing was changed. Re-run with POST to apply. Run after migrate-deposits.",
        }),
  };
}

export async function GET() {
  return NextResponse.json(await run(false));
}

export async function POST() {
  return NextResponse.json(await run(true));
}
