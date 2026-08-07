import { NextResponse } from "next/server";
import ddb, { TABLE_NAME } from "@/lib/db";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { getUploadUrl } from "@/lib/s3";
import { docKey, getDocumentItem } from "@/lib/documentsStore";
import { v4 as uuid } from "uuid";

// POST /api/documents/<id>/files — attach more scans to an existing document.
// Body: { files: [{ name, type }] } → presigned PUT URLs, same flow as the
// create endpoint. Appended with list_append so a concurrent add can't drop
// the other's files.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await req.json()) as { files?: { name: string; type: string }[] };

  if (!body.files?.length) {
    return NextResponse.json({ error: "files array is required" }, { status: 400 });
  }

  const existing = await getDocumentItem(id);
  if (!existing) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  const uploads: { id: string; upload_url: string }[] = [];
  const newFiles = [];
  for (const file of body.files) {
    const fileId = uuid();
    const ext = file.name.includes(".")
      ? file.name.substring(file.name.lastIndexOf("."))
      : "";
    const s3Key = `documents/${id}/${fileId}${ext}`;
    newFiles.push({
      fileId,
      s3Key,
      originalName: file.name,
      contentType: file.type || "",
    });
    uploads.push({ id: fileId, upload_url: await getUploadUrl(s3Key, file.type) });
  }

  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: docKey(id),
      UpdateExpression:
        "SET #files = list_append(if_not_exists(#files, :empty), :new), #updatedAt = :now",
      ExpressionAttributeNames: { "#files": "files", "#updatedAt": "updatedAt" },
      ExpressionAttributeValues: {
        ":empty": [],
        ":new": newFiles,
        ":now": new Date().toISOString(),
      },
      ConditionExpression: "attribute_exists(PK)",
    })
  );

  return NextResponse.json({ uploads }, { status: 201 });
}
