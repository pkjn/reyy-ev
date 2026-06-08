import { NextResponse } from "next/server";
import ddb, { TABLE_NAME } from "@/lib/db";
import { DeleteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { isValidStatus } from "@/lib/leads";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await req.json()) as {
    name?: string;
    phones?: unknown;
    notes?: string | null;
    status?: unknown;
  };

  const setParts: string[] = [];
  const removeParts: string[] = [];
  const exprNames: Record<string, string> = {};
  const exprValues: Record<string, unknown> = {};

  if (body.name !== undefined) {
    if (!body.name.trim()) {
      return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 });
    }
    exprNames["#name"] = "name";
    exprValues[":name"] = body.name.trim();
    setParts.push("#name = :name");
  }

  if (body.phones !== undefined) {
    const cleaned = Array.from(
      new Set(
        (Array.isArray(body.phones) ? body.phones : [])
          .map((p) => (typeof p === "string" ? p.trim() : ""))
          .filter((p) => p.length > 0)
      )
    );
    exprNames["#phones"] = "phones";
    if (cleaned.length === 0) {
      removeParts.push("#phones");
    } else {
      exprValues[":phones"] = cleaned;
      setParts.push("#phones = :phones");
    }
  }

  if (body.notes !== undefined) {
    exprNames["#notes"] = "notes";
    const trimmed = typeof body.notes === "string" ? body.notes.trim() : "";
    if (trimmed) {
      exprValues[":notes"] = trimmed;
      setParts.push("#notes = :notes");
    } else {
      removeParts.push("#notes");
    }
  }

  if (body.status !== undefined) {
    if (!isValidStatus(body.status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    exprNames["#status"] = "status";
    exprValues[":status"] = body.status;
    setParts.push("#status = :status");
  }

  if (setParts.length === 0 && removeParts.length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  // Always bump updatedAt alongside whatever changed.
  exprNames["#updatedAt"] = "updatedAt";
  exprValues[":updatedAt"] = new Date().toISOString();
  setParts.push("#updatedAt = :updatedAt");

  const updateExpression = [
    setParts.length ? "SET " + setParts.join(", ") : "",
    removeParts.length ? "REMOVE " + removeParts.join(", ") : "",
  ]
    .filter(Boolean)
    .join(" ");

  try {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { PK: `LEAD#${id}`, SK: "PROFILE" },
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: exprNames,
        ExpressionAttributeValues: exprValues,
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
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }
    throw err;
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await ddb.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { PK: `LEAD#${id}`, SK: "PROFILE" },
    })
  );
  return NextResponse.json({ ok: true });
}
