// Driver location push endpoint.
//
// Receives a GPS ping from the driver's phone every ~60 seconds. Validates
// the coordinates, checks for an active rental, and upserts the
// LOCATION#<rentalId>#LATEST row in DynamoDB. Returns 204 on success.

import { NextResponse } from "next/server";
import { requireDriverJwt } from "@/lib/driverRequest";
import { getActiveRentalForDriver } from "@/lib/driverAuth";
import { isValidPing, upsertLatestLocation, LocationPing } from "@/lib/location";

export async function POST(req: Request) {
  let claims;
  try {
    claims = await requireDriverJwt(req);
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  // Map snake_case input to camelCase for the validator.
  const input = body as Record<string, unknown>;
  const ping = {
    lat: input.lat,
    lng: input.lng,
    accuracy: input.accuracy,
    battery: input.battery,
    capturedAt: input.captured_at,
  };

  if (!isValidPing(ping)) {
    return NextResponse.json(
      { error: "invalid coordinates" },
      { status: 400 }
    );
  }

  try {
    const rental = await getActiveRentalForDriver(claims.sub);
    if (!rental) {
      return NextResponse.json(
        { error: "no active rental" },
        { status: 403 }
      );
    }

    await upsertLatestLocation(
      claims.sub,
      rental.rentalId,
      ping as LocationPing
    );

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error("driver/location error:", err);
    return NextResponse.json(
      { error: "internal error" },
      { status: 500 }
    );
  }
}
