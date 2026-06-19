// Location ping: validation and DDB upsert for driver live tracking.
//
// Each active rental has exactly one LOCATION#<rentalId>#LATEST row that is
// overwritten every push (~60s). No history is kept at v1 — old positions
// are replaced. If history is needed later, add a TTL'd row type
// LOCATION#<rentalId>#<isoTs> without breaking anything.

import { PutCommand } from "@aws-sdk/lib-dynamodb";
import ddb, { TABLE_NAME } from "@/lib/db";

export interface LocationPing {
  lat: number;
  lng: number;
  accuracy?: number;
  battery?: number;
  capturedAt: string; // ISO 8601
}

// Maximum age of a ping's capturedAt before the server rejects it (prevents
// replay attacks with stale data).
const MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

export function isValidPing(input: unknown): input is LocationPing {
  if (!input || typeof input !== "object") return false;
  const obj = input as Record<string, unknown>;

  // lat: number, -90 ≤ lat ≤ 90
  if (typeof obj.lat !== "number" || obj.lat < -90 || obj.lat > 90) return false;

  // lng: number, -180 ≤ lng ≤ 180
  if (typeof obj.lng !== "number" || obj.lng < -180 || obj.lng > 180) return false;

  // accuracy: optional, number ≥ 0
  if (obj.accuracy !== undefined) {
    if (typeof obj.accuracy !== "number" || obj.accuracy < 0) return false;
  }

  // battery: optional, integer 0..100
  if (obj.battery !== undefined) {
    if (
      typeof obj.battery !== "number" ||
      !Number.isInteger(obj.battery) ||
      obj.battery < 0 ||
      obj.battery > 100
    ) {
      return false;
    }
  }

  // capturedAt: ISO 8601, must be within the last 10 minutes
  if (typeof obj.capturedAt !== "string") return false;
  const ts = Date.parse(obj.capturedAt);
  if (isNaN(ts)) return false;
  const age = Date.now() - ts;
  if (age < -60_000 || age > MAX_AGE_MS) return false; // allow 1 min clock skew into future

  return true;
}

export async function upsertLatestLocation(
  customerId: string,
  rentalId: string,
  ping: LocationPing
): Promise<void> {
  const now = new Date().toISOString();

  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `CUSTOMER#${customerId}`,
        SK: `LOCATION#${rentalId}#LATEST`,
        GSI1PK: "LOCATIONS",
        GSI1SK: now,
        rentalId,
        customerId,
        lat: ping.lat,
        lng: ping.lng,
        accuracy: ping.accuracy,
        batteryLevel: ping.battery,
        capturedAt: ping.capturedAt,
        receivedAt: now,
      },
    })
  );
}
