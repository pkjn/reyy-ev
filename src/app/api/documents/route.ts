import { NextResponse } from "next/server";
import ddb, { TABLE_NAME } from "@/lib/db";
import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { getUploadUrl } from "@/lib/s3";
import { docKeys, hydrate, validateClaim } from "@/lib/documentsStore";
import { isDocDate, parseAmount, toDocumentRecord } from "@/lib/documents";
import { v4 as uuid } from "uuid";

// GET /api/documents — the whole vault, newest document date first.
// GSI1SK is "<docDate>#<docId>", so a descending query is already in the right
// order. The list is small enough to filter/search client-side.
export async function GET() {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :pk",
      ExpressionAttributeValues: { ":pk": "DOCUMENTS" },
      ScanIndexForward: false,
    })
  );

  const documents = await Promise.all((res.Items || []).map(hydrate));
  return NextResponse.json(documents);
}

// POST /api/documents — file a new document.
// Body: { title, category, vendor, doc_date, ref_number, amount, gst_amount,
//         gst_claimed, gst_claim_period, notes, files: [{ name, type }] }
// Creates the row and returns presigned PUT URLs the client uploads the
// scans to (same two-step flow as customer photos).
export async function POST(req: Request) {
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
    files?: { name: string; type: string }[];
  };

  const title = (body.title || "").trim();
  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  const docDate = (body.doc_date || "").trim() || new Date().toISOString().slice(0, 10);
  if (!isDocDate(docDate)) {
    return NextResponse.json(
      { error: "doc_date must be YYYY-MM-DD" },
      { status: 400 }
    );
  }

  const amount = parseAmount(body.amount);
  if (Number.isNaN(amount)) {
    return NextResponse.json(
      { error: "amount must be a non-negative number" },
      { status: 400 }
    );
  }
  const gstAmount = parseAmount(body.gst_amount);
  if (Number.isNaN(gstAmount)) {
    return NextResponse.json(
      { error: "gst_amount must be a non-negative number" },
      { status: 400 }
    );
  }
  if (amount !== null && gstAmount !== null && gstAmount > amount) {
    return NextResponse.json(
      { error: "GST cannot be more than the total amount." },
      { status: 400 }
    );
  }

  const claim = validateClaim(Boolean(body.gst_claimed), body.gst_claim_period, gstAmount);
  if ("error" in claim) {
    return NextResponse.json({ error: claim.error }, { status: 400 });
  }

  const docId = uuid();
  const now = new Date().toISOString();

  // Register the files up front so the row and its S3 keys are written once —
  // the client then PUTs the bytes to each presigned URL.
  const uploads: { id: string; upload_url: string }[] = [];
  const files = [];
  for (const file of body.files || []) {
    const fileId = uuid();
    const ext = file.name.includes(".")
      ? file.name.substring(file.name.lastIndexOf("."))
      : "";
    const s3Key = `documents/${docId}/${fileId}${ext}`;
    files.push({
      fileId,
      s3Key,
      originalName: file.name,
      contentType: file.type || "",
    });
    uploads.push({ id: fileId, upload_url: await getUploadUrl(s3Key, file.type) });
  }

  const item = {
    ...docKeys(docId, docDate),
    docId,
    title,
    category: (body.category || "").trim() || "Other",
    vendor: (body.vendor || "").trim(),
    docDate,
    refNumber: (body.ref_number || "").trim(),
    amount,
    gstAmount,
    gstClaimed: claim.gstClaimed,
    gstClaimPeriod: claim.gstClaimPeriod,
    gstClaimedOn: claim.gstClaimed ? now : null,
    notes: (body.notes || "").trim(),
    files,
    createdAt: now,
    updatedAt: now,
  };

  await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));

  return NextResponse.json(
    { ...toDocumentRecord(item), uploads },
    { status: 201 }
  );
}
