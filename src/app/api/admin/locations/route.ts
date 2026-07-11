// Admin endpoint: list every active rental's latest GPS position.
//
// Queries the LOCATIONS GSI partition and enriches each row with the
// customer name and scooty label from the rental row. Filters out positions
// from closed rentals (orphaned rows left after a delete failure).

import { NextResponse } from "next/server";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import ddb, { TABLE_NAME } from "@/lib/db";

export async function GET() {
  try {
    // Fetch all live location rows via the LOCATIONS GSI.
    const locRes = await ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :pk",
        ExpressionAttributeValues: {
          ":pk": "LOCATIONS",
        },
        ScanIndexForward: false, // most recent first
      })
    );

    const locations = locRes.Items || [];
    const now = Date.now();

    // Fetch active rentals to filter out closed-rental orphans and to get
    // customer names / scooty labels.
    const rentalsRes = await ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :pk",
        ExpressionAttributeValues: {
          ":pk": "RENTALS",
        },
      })
    );

    // Build a set of active rental IDs with their metadata.
    const activeRentals = new Map<
      string,
      { customerName: string; scootyLabel: string; customerId: string }
    >();
    for (const item of rentalsRes.Items || []) {
      if (!item.endDate) {
        const sk = item.SK as string;
        const rentalId = sk.replace("RENTAL#", "");
        activeRentals.set(rentalId, {
          customerName: (item.customerName as string) || "",
          scootyLabel: (item.scootyLabel as string) || "",
          customerId: (item.customerId as string) || "",
        });
      }
    }

    // Join location rows with active rentals.
    const result = locations
      .filter((loc) => activeRentals.has(loc.rentalId as string))
      .map((loc) => {
        const rental = activeRentals.get(loc.rentalId as string)!;
        const capturedAt = loc.capturedAt as string;
        const secondsStale = Math.round(
          (now - new Date(capturedAt).getTime()) / 1000
        );

        return {
          rental_id: loc.rentalId,
          customer_id: loc.customerId,
          customer_name: rental.customerName,
          scooty_label: rental.scootyLabel,
          lat: loc.lat,
          lng: loc.lng,
          accuracy: loc.accuracy ?? null,
          battery: loc.batteryLevel ?? null,
          captured_at: capturedAt,
          received_at: loc.receivedAt,
          seconds_stale: secondsStale,
        };
      });

    return NextResponse.json(result);
  } catch (err) {
    console.error("admin/locations error:", err);
    return NextResponse.json(
      { error: "internal error" },
      { status: 500 }
    );
  }
}
