// Admin route: set (or generate) a driver password for a customer.
//
// Gated by the site-password cookie via proxy.ts (same auth as the rest of
// the dashboard). Transactionally updates the customer profile with a bcrypt
// hash and ensures a PHONE# uniqueness row exists for login lookups.

import { NextResponse } from "next/server";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import ddb, { TABLE_NAME } from "@/lib/db";
import {
  setDriverPassword,
  generatePassword,
  normalisePhone,
} from "@/lib/driverAuth";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: customerId } = await params;

  // Verify customer exists and has a phone.
  const profileRes = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `CUSTOMER#${customerId}`, SK: "PROFILE" },
    })
  );
  if (!profileRes.Item) {
    return NextResponse.json({ error: "customer not found" }, { status: 404 });
  }

  const phones = (profileRes.Item.phones as string[]) || [];
  if (phones.length === 0 || !normalisePhone(phones[0])) {
    return NextResponse.json(
      { error: "customer has no phone" },
      { status: 422 }
    );
  }

  const body = (await req.json()) as {
    password?: string;
    generate?: boolean;
  };

  let password: string;
  let generated = false;

  if (body.generate) {
    password = generatePassword();
    generated = true;
  } else if (typeof body.password === "string") {
    password = body.password;
  } else {
    return NextResponse.json(
      { error: "password or generate required" },
      { status: 400 }
    );
  }

  if (password.length < 6) {
    return NextResponse.json(
      { error: "password too short" },
      { status: 400 }
    );
  }

  if (password.length > 128) {
    return NextResponse.json(
      { error: "password too long" },
      { status: 400 }
    );
  }

  try {
    await setDriverPassword(customerId, password);
  } catch (err: unknown) {
    // TransactionCanceledException with ConditionalCheckFailed on the PHONE#
    // row means another customer already owns that phone.
    const message =
      err instanceof Error ? err.message : "internal error";

    if (message === "customer has no phone") {
      return NextResponse.json({ error: message }, { status: 422 });
    }

    // Check for DDB conditional check failure (phone conflict).
    const errName = (err as { name?: string })?.name || "";
    if (errName === "TransactionCanceledException") {
      return NextResponse.json(
        { error: "phone already in use" },
        { status: 409 }
      );
    }

    console.error("set-driver-password error:", errName, message);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    // Echo the password only when it was generated (the admin needs to copy
    // it and hand it to the driver in person).
    ...(generated ? { password } : {}),
  });
}
