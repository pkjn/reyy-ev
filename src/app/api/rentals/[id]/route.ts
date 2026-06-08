import { NextResponse } from "next/server";
import ddb, { TABLE_NAME } from "@/lib/db";
import {
  GetCommand,
  QueryCommand,
  UpdateCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { isValidDateString } from "@/lib/billing";
import { deleteObject } from "@/lib/s3";

async function lookupCustomerId(
  rentalId: string,
  fromQuery: string | null
): Promise<string | null> {
  if (fromQuery) return fromQuery;
  // Fall back to the global RENTALID marker so the rental endpoints work even
  // when the client doesn't pass customer_id (e.g. from a deep link).
  const res = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `RENTALID#${rentalId}`, SK: "UNIQUE" },
    })
  );
  return (res.Item?.customerId as string) || null;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: rentalId } = await params;
  const url = new URL(req.url);
  const customerId = await lookupCustomerId(
    rentalId,
    url.searchParams.get("customer_id")
  );
  if (!customerId) {
    return NextResponse.json({ error: "Rental not found" }, { status: 404 });
  }

  const body = (await req.json()) as {
    customer_id?: string;
    end_date?: string | null;
    notes?: string | null;
    scooty_label?: string;
    security_deposit?: number;
    refundable_deposit?: number;
  };

  const setParts: string[] = [];
  const removeParts: string[] = [];
  const exprNames: Record<string, string> = {};
  const exprValues: Record<string, unknown> = {};

  if (body.end_date !== undefined) {
    exprNames["#endDate"] = "endDate";
    if (body.end_date === null || body.end_date === "") {
      removeParts.push("#endDate");
    } else if (!isValidDateString(body.end_date)) {
      return NextResponse.json(
        { error: "end_date must be YYYY-MM-DD" },
        { status: 400 }
      );
    } else {
      exprValues[":endDate"] = body.end_date;
      setParts.push("#endDate = :endDate");
    }
  }

  if (body.notes !== undefined) {
    exprNames["#notes"] = "notes";
    const trimmed = (body.notes || "").trim();
    if (trimmed) {
      exprValues[":notes"] = trimmed;
      setParts.push("#notes = :notes");
    } else {
      removeParts.push("#notes");
    }
  }

  if (body.scooty_label !== undefined) {
    const trimmed = body.scooty_label.trim();
    if (!trimmed) {
      return NextResponse.json(
        { error: "scooty_label cannot be empty" },
        { status: 400 }
      );
    }
    exprNames["#scootyLabel"] = "scootyLabel";
    exprValues[":scootyLabel"] = trimmed;
    setParts.push("#scootyLabel = :scootyLabel");
  }

  // Editing the deposit targets — needs the rental's current values (to
  // cross-validate when only one field is sent) and the amount already
  // collected (the new target can't drop below money we've taken).
  if (
    body.security_deposit !== undefined ||
    body.refundable_deposit !== undefined
  ) {
    const [rentalRes, depositsRes] = await Promise.all([
      ddb.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { PK: `CUSTOMER#${customerId}`, SK: `RENTAL#${rentalId}` },
        })
      ),
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
    ]);
    if (!rentalRes.Item) {
      return NextResponse.json({ error: "Rental not found" }, { status: 404 });
    }
    const curSecurity = (rentalRes.Item.securityDeposit as number) || 0;
    const curRefundable = (rentalRes.Item.refundableDeposit as number) || 0;
    const newSecurity =
      body.security_deposit !== undefined
        ? body.security_deposit
        : curSecurity;
    const newRefundable =
      body.refundable_deposit !== undefined
        ? body.refundable_deposit
        : curRefundable;

    if (
      typeof newSecurity !== "number" ||
      !(newSecurity >= 0) ||
      typeof newRefundable !== "number" ||
      !(newRefundable >= 0)
    ) {
      return NextResponse.json(
        { error: "deposit amounts must be non-negative numbers" },
        { status: 400 }
      );
    }
    if (newRefundable > newSecurity) {
      return NextResponse.json(
        { error: "refundable_deposit cannot exceed security_deposit" },
        { status: 400 }
      );
    }
    const collected = (depositsRes.Items || []).reduce(
      (s, d) => s + ((d.amount as number) || 0),
      0
    );
    if (newSecurity < collected) {
      return NextResponse.json(
        {
          error: `security_deposit cannot be below the ₹${collected} already collected`,
        },
        { status: 400 }
      );
    }

    if (body.security_deposit !== undefined) {
      exprNames["#securityDeposit"] = "securityDeposit";
      if (newSecurity > 0) {
        exprValues[":securityDeposit"] = newSecurity;
        setParts.push("#securityDeposit = :securityDeposit");
      } else {
        removeParts.push("#securityDeposit");
      }
    }
    if (body.refundable_deposit !== undefined) {
      exprNames["#refundableDeposit"] = "refundableDeposit";
      if (newRefundable > 0) {
        exprValues[":refundableDeposit"] = newRefundable;
        setParts.push("#refundableDeposit = :refundableDeposit");
      } else {
        removeParts.push("#refundableDeposit");
      }
    }
  }

  if (setParts.length === 0 && removeParts.length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const updateExpression = [
    setParts.length ? "SET " + setParts.join(", ") : "",
    removeParts.length ? "REMOVE " + removeParts.join(", ") : "",
  ]
    .filter(Boolean)
    .join(" ");

  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: `CUSTOMER#${customerId}`, SK: `RENTAL#${rentalId}` },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: exprNames,
      ...(Object.keys(exprValues).length > 0 && {
        ExpressionAttributeValues: exprValues,
      }),
    })
  );

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: rentalId } = await params;
  const url = new URL(req.url);
  const customerId = await lookupCustomerId(
    rentalId,
    url.searchParams.get("customer_id")
  );
  if (!customerId) {
    return NextResponse.json({ error: "Rental not found" }, { status: 404 });
  }

  // Gather every child row of this rental — payments, the deposit, and any
  // deposit refunds — so we can wipe them all in one shot.
  const [paymentsRes, depositRes, refundsRes] = await Promise.all([
    ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: {
          ":pk": `CUSTOMER#${customerId}`,
          ":sk": `PAYMENT#${rentalId}#`,
        },
      })
    ),
    ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: {
          ":pk": `CUSTOMER#${customerId}`,
          // No trailing # so legacy DEPOSIT#<rid> rows match alongside
          // installment DEPOSIT#<rid>#<id> rows.
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

  const childItems = [
    ...(paymentsRes.Items || []),
    ...(depositRes.Items || []),
    ...(refundsRes.Items || []),
  ];

  // Best-effort: wipe any screenshots from S3 before the DDB transaction so we
  // don't leave orphaned objects.
  await Promise.all(
    childItems
      .filter((p) => typeof p.screenshotS3Key === "string")
      .map((p) => deleteObject(p.screenshotS3Key as string))
  );

  // Transaction allows up to 100 items — fine for a single rental's history.
  const transactItems = [
    {
      Delete: {
        TableName: TABLE_NAME,
        Key: { PK: `CUSTOMER#${customerId}`, SK: `RENTAL#${rentalId}` },
      },
    },
    {
      Delete: {
        TableName: TABLE_NAME,
        Key: { PK: `RENTALID#${rentalId}`, SK: "UNIQUE" },
      },
    },
    ...childItems.map((p) => ({
      Delete: {
        TableName: TABLE_NAME,
        Key: { PK: p.PK as string, SK: p.SK as string },
      },
    })),
  ];

  await ddb.send(new TransactWriteCommand({ TransactItems: transactItems }));

  return NextResponse.json({ ok: true });
}
