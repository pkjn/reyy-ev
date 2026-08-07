import { NextResponse } from "next/server";
import ddb, { TABLE_NAME } from "@/lib/db";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { deleteObject } from "@/lib/s3";
import { docKey, getDocumentItem, storedFiles } from "@/lib/documentsStore";

// DELETE /api/documents/<id>/files/<fileId> — remove one scan, keeping the
// document itself.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> }
) {
  const { id, fileId } = await params;

  const item = await getDocumentItem(id);
  if (!item) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  const files = storedFiles(item);
  const target = files.find((f) => f.fileId === fileId);
  if (!target) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  await deleteObject(target.s3Key);
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: docKey(id),
      UpdateExpression: "SET #files = :files, #updatedAt = :now",
      ExpressionAttributeNames: { "#files": "files", "#updatedAt": "updatedAt" },
      ExpressionAttributeValues: {
        ":files": files.filter((f) => f.fileId !== fileId),
        ":now": new Date().toISOString(),
      },
    })
  );

  return NextResponse.json({ ok: true });
}
