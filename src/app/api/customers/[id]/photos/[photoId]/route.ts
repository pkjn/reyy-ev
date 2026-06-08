import { NextResponse } from "next/server";
import ddb, { TABLE_NAME } from "@/lib/db";
import { GetCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { deleteObject } from "@/lib/s3";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; photoId: string }> }
) {
  const { id: customerId, photoId } = await params;

  const res = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `CUSTOMER#${customerId}`, SK: `PHOTO#${photoId}` },
    })
  );
  if (!res.Item) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await deleteObject(res.Item.s3Key as string);
  await ddb.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { PK: `CUSTOMER#${customerId}`, SK: `PHOTO#${photoId}` },
    })
  );

  return NextResponse.json({ ok: true });
}
