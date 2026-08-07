import { NextResponse } from "next/server";
import ddb, { TABLE_NAME } from "@/lib/db";
import { DeleteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { deleteObject } from "@/lib/s3";
import {
  docKey,
  getDocumentItem,
  hydrate,
  storedFiles,
  validateClaim,
} from "@/lib/documentsStore";
import { isDocDate, parseAmount } from "@/lib/documents";

// GET /api/documents/<id> — one document with presigned links to its files.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const item = await getDocumentItem(id);
  if (!item) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }
  return NextResponse.json(await hydrate(item));
}

// PATCH /api/documents/<id> — edit metadata, or tick the GST claim on/off.
// Every field is optional; only what's sent is written. Amount/GST and the
// claim are cross-checked against the *stored* values so a partial update
// (e.g. just `gst_claimed`) still validates against the real numbers.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await req.json()) as {
    title?: string;
    category?: string;
    vendor?: string;
    doc_date?: string;
    ref_number?: string;
    amount?: string | number | null;
    gst_amount?: string | number | null;
    gst_claimed?: boolean;
    gst_claim_period?: string | null;
    notes?: string;
  };

  const existing = await getDocumentItem(id);
  if (!existing) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  const setParts: string[] = [];
  const exprNames: Record<string, string> = {};
  const exprValues: Record<string, unknown> = {};
  const set = (alias: string, attr: string, value: unknown) => {
    exprNames[`#${alias}`] = attr;
    exprValues[`:${alias}`] = value;
    setParts.push(`#${alias} = :${alias}`);
  };

  if (body.title !== undefined) {
    const title = body.title.trim();
    if (!title) {
      return NextResponse.json({ error: "title cannot be empty" }, { status: 400 });
    }
    set("title", "title", title);
  }
  if (body.category !== undefined) {
    set("category", "category", body.category.trim() || "Other");
  }
  if (body.vendor !== undefined) set("vendor", "vendor", body.vendor.trim());
  if (body.ref_number !== undefined) {
    set("refNumber", "refNumber", body.ref_number.trim());
  }
  if (body.notes !== undefined) set("notes", "notes", body.notes.trim());

  if (body.doc_date !== undefined) {
    const docDate = body.doc_date.trim();
    if (!isDocDate(docDate)) {
      return NextResponse.json(
        { error: "doc_date must be YYYY-MM-DD" },
        { status: 400 }
      );
    }
    set("docDate", "docDate", docDate);
    // The list is ordered by GSI1SK, so the sort key has to follow the date.
    set("gsi1sk", "GSI1SK", `${docDate}#${id}`);
  }

  // Resolve the effective amounts: whatever was sent, else what's stored.
  let amount =
    typeof existing.amount === "number" ? (existing.amount as number) : null;
  if (body.amount !== undefined) {
    amount = parseAmount(body.amount);
    if (Number.isNaN(amount)) {
      return NextResponse.json(
        { error: "amount must be a non-negative number" },
        { status: 400 }
      );
    }
    set("amount", "amount", amount);
  }
  let gstAmount =
    typeof existing.gstAmount === "number" ? (existing.gstAmount as number) : null;
  if (body.gst_amount !== undefined) {
    gstAmount = parseAmount(body.gst_amount);
    if (Number.isNaN(gstAmount)) {
      return NextResponse.json(
        { error: "gst_amount must be a non-negative number" },
        { status: 400 }
      );
    }
    set("gstAmount", "gstAmount", gstAmount);
  }
  if (amount !== null && gstAmount !== null && gstAmount > amount) {
    return NextResponse.json(
      { error: "GST cannot be more than the total amount." },
      { status: 400 }
    );
  }

  // Editing the GST amount away from a claimed document would leave a claim
  // with nothing behind it, so clear the claim in that case.
  const claimTouched =
    body.gst_claimed !== undefined || body.gst_claim_period !== undefined;
  const wantClaimed =
    body.gst_claimed !== undefined
      ? body.gst_claimed
      : Boolean(existing.gstClaimed);
  if (claimTouched || (wantClaimed && !gstAmount)) {
    const claim = validateClaim(
      wantClaimed && Boolean(gstAmount),
      body.gst_claim_period !== undefined
        ? body.gst_claim_period
        : (existing.gstClaimPeriod as string | null),
      gstAmount
    );
    if ("error" in claim) {
      return NextResponse.json({ error: claim.error }, { status: 400 });
    }
    set("gstClaimed", "gstClaimed", claim.gstClaimed);
    set("gstClaimPeriod", "gstClaimPeriod", claim.gstClaimPeriod);
    set(
      "gstClaimedOn",
      "gstClaimedOn",
      claim.gstClaimed
        ? (existing.gstClaimedOn as string) || new Date().toISOString()
        : null
    );
  }

  if (setParts.length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }
  set("updatedAt", "updatedAt", new Date().toISOString());

  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: docKey(id),
      UpdateExpression: `SET ${setParts.join(", ")}`,
      ExpressionAttributeNames: exprNames,
      ExpressionAttributeValues: exprValues,
      ConditionExpression: "attribute_exists(PK)",
    })
  );

  const updated = await getDocumentItem(id);
  return NextResponse.json(updated ? await hydrate(updated) : { ok: true });
}

// DELETE /api/documents/<id> — drop the row and every scan it holds.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const item = await getDocumentItem(id);
  if (!item) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  await Promise.all(storedFiles(item).map((f) => deleteObject(f.s3Key)));
  await ddb.send(new DeleteCommand({ TableName: TABLE_NAME, Key: docKey(id) }));

  return NextResponse.json({ ok: true });
}
