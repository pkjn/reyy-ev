// Driver login: phone + password → JWT.
//
// Public endpoint (no auth). Normalises the phone, looks up the customer
// via the PHONE# uniqueness row, verifies bcrypt, and issues a 90-day JWT.
//
// Security: constant-time bcrypt verify runs even when the phone is unknown
// (compare against a fixed dummy hash) so timing attacks against phone
// enumeration are ineffective.

import { NextResponse } from "next/server";
import {
  normalisePhone,
  findCustomerByPhone,
  verifyDriverPassword,
  getActiveRentalForDriver,
} from "@/lib/driverAuth";
import { signDriverJwt } from "@/lib/jwt";

// In-memory rate limit: 5 attempts per phone per 5 minutes.
// Sufficient for v1 on a single-region deployment.
const rateLimits = new Map<
  string,
  { count: number; resetAt: number }
>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 5 * 60 * 1000; // 5 minutes

function isRateLimited(phone: string): boolean {
  const now = Date.now();
  const entry = rateLimits.get(phone);

  if (!entry || now > entry.resetAt) {
    rateLimits.set(phone, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }

  entry.count++;
  return entry.count > MAX_ATTEMPTS;
}

export async function POST(req: Request) {
  let body: { phone?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "invalid json" },
      { status: 400 }
    );
  }

  if (
    typeof body.phone !== "string" ||
    typeof body.password !== "string" ||
    !body.phone.trim() ||
    !body.password.trim()
  ) {
    return NextResponse.json(
      { error: "phone and password required" },
      { status: 400 }
    );
  }

  const phone = normalisePhone(body.phone);
  if (!phone) {
    return NextResponse.json(
      { error: "invalid credentials" },
      { status: 401 }
    );
  }

  // Rate limit before any DB calls.
  if (isRateLimited(phone)) {
    return NextResponse.json(
      { error: "too many attempts, try again later" },
      { status: 429 }
    );
  }

  try {
    const customer = await findCustomerByPhone(phone);

    // Even when the customer doesn't exist, run the password check against a
    // dummy hash so the response time doesn't leak whether the phone is valid.
    const customerId = customer?.customerId || "__nonexistent__";
    const valid = await verifyDriverPassword(customerId, body.password);

    if (!customer || !valid) {
      return NextResponse.json(
        { error: "invalid credentials" },
        { status: 401 }
      );
    }

    // Check for an active rental — drivers without an active rental can't use
    // the app (nothing to show on the home page, no rental to track).
    const rental = await getActiveRentalForDriver(customer.customerId);
    if (!rental) {
      return NextResponse.json(
        { error: "no active rental" },
        { status: 403 }
      );
    }

    const token = await signDriverJwt({
      sub: customer.customerId,
      name: customer.name,
      phone,
    });

    return NextResponse.json({
      token,
      customer_id: customer.customerId,
      customer_name: customer.name,
    });
  } catch (err) {
    console.error("driver login error:", err);
    return NextResponse.json(
      { error: "internal error" },
      { status: 500 }
    );
  }
}
