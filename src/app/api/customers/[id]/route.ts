import { NextResponse } from "next/server";
import ddb, { TABLE_NAME } from "@/lib/db";
import {
  QueryCommand,
  BatchWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { getViewUrl, deleteObject } from "@/lib/s3";
import { computeRentalBalances, Payment, Rental, readPauses } from "@/lib/billing";
import { CustomerId, isValidIdType } from "@/lib/idTypes";
import { v4 as uuid } from "uuid";

// Back-compat: read the structured `ids` array if present, otherwise fall back
// to the original idType/idNumber single-string shape.
function readIds(profile: Record<string, unknown>): CustomerId[] {
  if (Array.isArray(profile.ids)) {
    return (profile.ids as Record<string, unknown>[]).map((r) => ({
      id: (r.id as string) || uuid(),
      type: isValidIdType(r.type) ? r.type : "other",
      number: (r.number as string) || "",
      originalSubmitted:
        r.originalSubmitted === true || r.original_submitted === true,
      createdAt: (r.createdAt as string) || new Date().toISOString(),
    }));
  }
  const legacyType = profile.idType as string | undefined;
  const legacyNumber = profile.idNumber as string | undefined;
  if (legacyType && legacyNumber) {
    return [
      {
        id: uuid(),
        type: isValidIdType(legacyType) ? legacyType : "other",
        number: legacyNumber,
        originalSubmitted: false,
        createdAt: (profile.createdAt as string) || new Date().toISOString(),
      },
    ];
  }
  return [];
}

// Whether a stored media item is a photo or a video. New records carry the
// browser-supplied `contentType`; older photo-only records don't, so fall back
// to the file extension (defaulting to image, since everything before videos
// were supported was a photo).
function mediaKind(item: Record<string, unknown>): "image" | "video" {
  const ct = typeof item.contentType === "string" ? item.contentType : "";
  if (ct.startsWith("video/")) return "video";
  if (ct.startsWith("image/")) return "image";
  const name = `${item.s3Key ?? ""}${item.originalName ?? ""}`.toLowerCase();
  return /\.(mp4|mov|webm|avi|mkv|m4v|3gp)$/.test(name) ? "video" : "image";
}

function normaliseIds(raw: unknown): CustomerId[] {
  if (!Array.isArray(raw)) return [];
  const now = new Date().toISOString();
  const out: CustomerId[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const rec = r as Record<string, unknown>;
    const type = rec.type;
    const number = typeof rec.number === "string" ? rec.number.trim() : "";
    if (!isValidIdType(type) || !number) continue;
    out.push({
      id: typeof rec.id === "string" && rec.id ? rec.id : uuid(),
      type,
      number,
      originalSubmitted:
        rec.original_submitted === true || rec.originalSubmitted === true,
      createdAt:
        typeof rec.created_at === "string"
          ? rec.created_at
          : typeof rec.createdAt === "string"
            ? rec.createdAt
            : now,
    });
  }
  return out;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: { ":pk": `CUSTOMER#${id}` },
    })
  );

  const items = result.Items || [];
  const profile = items.find((i) => i.SK === "PROFILE");
  if (!profile) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const photoItems = items.filter(
    (i) => typeof i.SK === "string" && i.SK.startsWith("PHOTO#")
  );
  const rentalItems = items.filter(
    (i) => typeof i.SK === "string" && i.SK.startsWith("RENTAL#")
  );
  const paymentItems = items.filter(
    (i) => typeof i.SK === "string" && i.SK.startsWith("PAYMENT#")
  );
  const depositItems = items.filter(
    (i) => typeof i.SK === "string" && i.SK.startsWith("DEPOSIT#")
  );
  const refundItems = items.filter(
    (i) => typeof i.SK === "string" && i.SK.startsWith("DEPOSITREFUND#")
  );

  const photos = await Promise.all(
    photoItems.map(async (p) => ({
      id: p.photoId as string,
      original_name: p.originalName as string,
      url: await getViewUrl(p.s3Key as string),
      kind: mediaKind(p),
      created_at: p.createdAt as string,
    }))
  );
  photos.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  // Build payments + sign any screenshot view URLs in parallel.
  const paymentRecords = paymentItems.map((p) => ({
    rentalId: p.rentalId as string,
    s3Key: (p.screenshotS3Key as string) || null,
    payment: {
      id: p.paymentId as string,
      amount: p.amount as number,
      paidOn: p.paidOn as string,
      account: (p.account as string) || null,
      accountName: (p.accountName as string) || null,
      receiptId: (p.receiptId as string) || null,
      note: (p.note as string) || null,
      screenshotUrl: null as string | null,
      createdAt: p.createdAt as string,
    } satisfies Payment,
  }));
  await Promise.all(
    paymentRecords.map(async (r) => {
      if (r.s3Key) r.payment.screenshotUrl = await getViewUrl(r.s3Key);
    })
  );
  const paymentsByRental = new Map<string, Payment[]>();
  for (const r of paymentRecords) {
    const list = paymentsByRental.get(r.rentalId) || [];
    list.push(r.payment);
    paymentsByRental.set(r.rentalId, list);
  }

  // Deposits — a rental may collect its security deposit in installments, so
  // there can be several per rental. Each is a cash entry with its account and
  // any signed screenshot.
  interface DepositView {
    id: string;
    amount: number;
    date: string;
    account: string | null;
    account_name: string | null;
    receipt_id: string | null;
    note: string | null;
    screenshot_url: string | null;
  }
  const depositRecords = depositItems.map((d) => ({
    rentalId: d.rentalId as string,
    s3Key: (d.screenshotS3Key as string) || null,
    deposit: {
      id: d.depositId as string,
      amount: (d.amount as number) || 0,
      date: d.date as string,
      account: (d.account as string) || null,
      account_name: (d.accountName as string) || null,
      receipt_id: (d.receiptId as string) || null,
      note: (d.note as string) || null,
      screenshot_url: null as string | null,
    } satisfies DepositView,
  }));
  await Promise.all(
    depositRecords.map(async (d) => {
      if (d.s3Key) d.deposit.screenshot_url = await getViewUrl(d.s3Key);
    })
  );
  const depositsByRental = new Map<string, DepositView[]>();
  for (const d of depositRecords) {
    const list = depositsByRental.get(d.rentalId) || [];
    list.push(d.deposit);
    depositsByRental.set(d.rentalId, list);
  }

  // Refunds (deposit money returned), with signed screenshots.
  interface RefundView {
    id: string;
    amount: number;
    date: string;
    account: string | null;
    account_name: string | null;
    note: string | null;
    screenshot_url: string | null;
    created_at: string;
  }
  const refundRecords = refundItems.map((r) => ({
    rentalId: r.rentalId as string,
    s3Key: (r.screenshotS3Key as string) || null,
    refund: {
      id: r.refundId as string,
      amount: r.amount as number,
      date: r.date as string,
      account: (r.account as string) || null,
      account_name: (r.accountName as string) || null,
      note: (r.note as string) || null,
      screenshot_url: null as string | null,
      created_at: r.createdAt as string,
    } satisfies RefundView,
  }));
  await Promise.all(
    refundRecords.map(async (r) => {
      if (r.s3Key) r.refund.screenshot_url = await getViewUrl(r.s3Key);
    })
  );
  const refundsByRental = new Map<string, RefundView[]>();
  for (const r of refundRecords) {
    const list = refundsByRental.get(r.rentalId) || [];
    list.push(r.refund);
    refundsByRental.set(r.rentalId, list);
  }

  const rentals = rentalItems
    .map((r) => {
      const rental: Rental = {
        id: r.rentalId as string,
        customerId: r.customerId as string,
        customerName: (r.customerName as string) || (profile.name as string),
        scootyLabel: r.scootyLabel as string,
        startDate: r.startDate as string,
        endDate: (r.endDate as string) || null,
        rate: r.rate as number,
        rateUnit: r.rateUnit as Rental["rateUnit"],
        securityDeposit: (r.securityDeposit as number) || 0,
        refundableDeposit: (r.refundableDeposit as number) || 0,
        notes: (r.notes as string) || null,
        pauses: readPauses(r),
        createdAt: r.createdAt as string,
      };
      const payments = (paymentsByRental.get(rental.id) || []).sort((a, b) =>
        a.paidOn < b.paidOn ? 1 : -1
      );
      const refunds = (refundsByRental.get(rental.id) || []).sort((a, b) =>
        a.date < b.date ? 1 : -1
      );
      const deposits = (depositsByRental.get(rental.id) || []).sort((a, b) =>
        a.date < b.date ? 1 : a.date > b.date ? -1 : 0
      );
      // Scooty assignment history — synthesise the first entry from the legacy
      // single label for rentals created before swaps were tracked.
      const scooties =
        Array.isArray(r.scooties) && r.scooties.length > 0
          ? (r.scooties as Record<string, unknown>[]).map((s) => ({
              label: (s.label as string) || "",
              from: (s.from as string) || (r.startDate as string),
              note: (s.note as string) || null,
            }))
          : [
              {
                label: (r.scootyLabel as string) || "",
                from: r.startDate as string,
                note: null,
              },
            ];
      const balances = computeRentalBalances(rental, payments);
      return { ...rental, payments, refunds, deposits, scooties, balances };
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  const phones: string[] = Array.isArray(profile.phones)
    ? (profile.phones as string[])
    : typeof profile.phone === "string" && (profile.phone as string).trim()
      ? [profile.phone as string]
      : [];

  return NextResponse.json({
    id: profile.customerId,
    name: profile.name,
    phones,
    address: profile.address || null,
    map_location: profile.mapLocation || null,
    notes: profile.notes || null,
    ids: readIds(profile),
    created_at: profile.createdAt,
    photos,
    rentals,
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await req.json()) as {
    name?: string;
    phones?: string[];
    address?: string | null;
    map_location?: string | null;
    notes?: string | null;
    ids?: unknown;
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
        body.phones
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

  if (body.address !== undefined) {
    exprNames["#address"] = "address";
    const trimmed = typeof body.address === "string" ? body.address.trim() : "";
    if (trimmed) {
      exprValues[":address"] = trimmed;
      setParts.push("#address = :address");
    } else {
      removeParts.push("#address");
    }
  }

  if (body.map_location !== undefined) {
    exprNames["#mapLocation"] = "mapLocation";
    const trimmed =
      typeof body.map_location === "string" ? body.map_location.trim() : "";
    if (trimmed) {
      exprValues[":mapLocation"] = trimmed;
      setParts.push("#mapLocation = :mapLocation");
    } else {
      removeParts.push("#mapLocation");
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

  if (body.ids !== undefined) {
    const ids = normaliseIds(body.ids);
    exprNames["#ids"] = "ids";
    if (ids.length === 0) {
      removeParts.push("#ids");
    } else {
      exprValues[":ids"] = ids;
      setParts.push("#ids = :ids");
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

  try {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { PK: `CUSTOMER#${id}`, SK: "PROFILE" },
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: exprNames,
        ...(Object.keys(exprValues).length > 0 && {
          ExpressionAttributeValues: exprValues,
        }),
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
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
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

  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: { ":pk": `CUSTOMER#${id}` },
    })
  );

  const items = result.Items || [];
  if (items.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const photoItems = items.filter(
    (i) => typeof i.SK === "string" && i.SK.startsWith("PHOTO#")
  );
  // Payments, deposit installments and deposit refunds can all carry a
  // screenshot — wipe every one so we don't orphan S3 objects.
  const itemsWithScreenshots = items.filter(
    (i) => typeof i.screenshotS3Key === "string"
  );
  await Promise.all([
    ...photoItems.map((i) => deleteObject(i.s3Key as string)),
    ...itemsWithScreenshots.map((i) =>
      deleteObject(i.screenshotS3Key as string)
    ),
  ]);

  // Rentals carry a global RENTALID#<id> uniqueness marker — collect those so
  // we delete them alongside the customer-scoped rows.
  const rentalIdMarkers = items
    .filter((i) => typeof i.SK === "string" && i.SK.startsWith("RENTAL#"))
    .map((i) => ({
      PK: `RENTALID#${i.rentalId}`,
      SK: "UNIQUE",
    }));

  const allDeletes = [
    ...items.map((item) => ({ PK: item.PK as string, SK: item.SK as string })),
    ...rentalIdMarkers,
  ];

  for (let i = 0; i < allDeletes.length; i += 25) {
    const batch = allDeletes.slice(i, i + 25).map((key) => ({
      DeleteRequest: { Key: key },
    }));
    await ddb.send(
      new BatchWriteCommand({
        RequestItems: { [TABLE_NAME]: batch },
      })
    );
  }

  return NextResponse.json({ ok: true });
}
