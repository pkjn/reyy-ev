import { NextResponse } from "next/server";
import ddb, { TABLE_NAME } from "@/lib/db";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { getUploadUrl } from "@/lib/s3";
import { v4 as uuid } from "uuid";

// POST /api/customers/<id>/photos
// Body: { files: [{ name, type }] }
// Creates PHOTO records and returns presigned PUT URLs the client uploads to.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: customerId } = await params;
  const body = (await req.json()) as {
    files: { name: string; type: string }[];
  };

  if (!body.files?.length) {
    return NextResponse.json({ error: "files array is required" }, { status: 400 });
  }

  const customerRes = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `CUSTOMER#${customerId}`, SK: "PROFILE" },
    })
  );
  if (!customerRes.Item) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }

  const now = new Date().toISOString();
  const uploads = [];
  for (const file of body.files) {
    const photoId = uuid();
    const ext = file.name.includes(".")
      ? file.name.substring(file.name.lastIndexOf("."))
      : "";
    const s3Key = `customers/${customerId}/${photoId}${ext}`;

    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: `CUSTOMER#${customerId}`,
          SK: `PHOTO#${photoId}`,
          photoId,
          customerId,
          originalName: file.name,
          contentType: file.type || "",
          s3Key,
          createdAt: now,
        },
      })
    );

    uploads.push({
      id: photoId,
      upload_url: await getUploadUrl(s3Key, file.type),
    });
  }

  return NextResponse.json({ uploads }, { status: 201 });
}
