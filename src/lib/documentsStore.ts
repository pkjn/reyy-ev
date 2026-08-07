// Server-side reads for the document vault. Split from `documents.ts` so the
// pure types/helpers there stay importable from client components — this file
// pulls in the AWS SDK.

import ddb, { TABLE_NAME } from "@/lib/db";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { getViewUrl } from "@/lib/s3";
import { DocumentRecord, isClaimPeriod, toDocumentRecord } from "@/lib/documents";

export function docKey(id: string) {
  return { PK: `DOC#${id}`, SK: "PROFILE" };
}

// Full key set for a write. The GSI1 sort key carries the document date, so
// editing the date has to rewrite it (see the PATCH route).
export function docKeys(docId: string, docDate: string) {
  return {
    ...docKey(docId),
    GSI1PK: "DOCUMENTS",
    GSI1SK: `${docDate}#${docId}`,
  };
}

// A claim is only meaningful once there's GST on the document, and a claimed
// document must say which return period it went into. Returns the pair of
// fields to store, or the message to send back as a 400.
export function validateClaim(
  gstClaimed: boolean,
  period: string | null | undefined,
  gstAmount: number | null
): { gstClaimed: boolean; gstClaimPeriod: string | null } | { error: string } {
  if (!gstClaimed) return { gstClaimed: false, gstClaimPeriod: null };
  if (!gstAmount) {
    return { error: "Record the GST amount before marking it claimed." };
  }
  const p = (period || "").trim();
  if (!isClaimPeriod(p)) {
    return { error: "gst_claim_period must be YYYY-MM when claimed" };
  }
  return { gstClaimed: true, gstClaimPeriod: p };
}

// The stored shape of one file on a document row.
export interface StoredFile {
  fileId: string;
  s3Key: string;
  originalName: string;
  contentType: string;
}

export function storedFiles(item: Record<string, unknown>): StoredFile[] {
  return Array.isArray(item.files) ? (item.files as StoredFile[]) : [];
}

export async function getDocumentItem(
  id: string
): Promise<Record<string, unknown> | null> {
  const res = await ddb.send(
    new GetCommand({ TableName: TABLE_NAME, Key: docKey(id) })
  );
  return res.Item || null;
}

// API shape + a presigned view link per file. Signing is a local HMAC (no
// network call), so doing it for every file of every document in the list is
// cheap.
export async function hydrate(
  item: Record<string, unknown>
): Promise<DocumentRecord> {
  const doc = toDocumentRecord(item);
  const keys = new Map(storedFiles(item).map((f) => [f.fileId, f.s3Key]));
  doc.files = await Promise.all(
    doc.files.map(async (f) => {
      const key = keys.get(f.id);
      return { ...f, url: key ? await getViewUrl(key) : null };
    })
  );
  return doc;
}
