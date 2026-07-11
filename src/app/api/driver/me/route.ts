// Driver home data endpoint.
//
// Returns the aggregated driver profile, active rental details, payment
// balances, and deposit status. Used by the WebView home page and can be
// called directly by the native app for data display.

import { NextResponse } from "next/server";
import { requireDriverJwt } from "@/lib/driverRequest";
import { buildDriverHomePayload } from "@/lib/driverHome";

export async function GET(req: Request) {
  let claims;
  try {
    claims = await requireDriverJwt(req);
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const payload = await buildDriverHomePayload(claims.sub);
    if (!payload) {
      return NextResponse.json(
        { error: "no active rental" },
        { status: 403 }
      );
    }

    return NextResponse.json(payload);
  } catch (err) {
    console.error("driver/me error:", err);
    return NextResponse.json(
      { error: "internal error" },
      { status: 500 }
    );
  }
}
