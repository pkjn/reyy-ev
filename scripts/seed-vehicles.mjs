// One-off bulk seed for the Vehicles view. Writes each vehicle exactly the way
// POST /api/vehicles does — a VEHICLE#<id>/PROFILE row (listed under
// GSI1PK=VEHICLES) plus a VEHICLENO#<plate>/UNIQUE marker, in one transaction.
// Idempotent: the attribute_not_exists guards mean a vehicle whose plate is
// already registered is skipped, so this is safe to re-run.
//
//   Run: node --env-file=.env.local scripts/seed-vehicles.mjs
//
// Source: Battery Smart E2W proposal email thread (chassis numbers + OEM make).
// Registration plates weren't in that document, so `number` uses Reyy's
// internal vehicle IDs; battery provider is Battery Smart for all.

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { v4 as uuid } from "uuid";

const TABLE_NAME = process.env.DYNAMODB_TABLE || "ReyyEV";
const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.AWS_REGION || "ap-south-1" }),
  { marshallOptions: { removeUndefinedValues: true } }
);

const normalizePlate = (s) => s.trim().replace(/\s+/g, " ").toUpperCase();

const VEHICLES = [
  { number: "REYY-0001", make: "AMO Electric Bikes - Jaunty", chassis: "ADCSYSL250904848" },
  { number: "REYY-0002", make: "AMO Electric Bikes - Jaunty", chassis: "ADCSYSL250904899" },
  { number: "REYY-0003", make: "AMO Electric Bikes - Jaunty", chassis: "ADCSYSL250901701" },
  { number: "REYY-0004", make: "AMO Electric Bikes - Jaunty", chassis: "ADCSYSL250901151" },
  { number: "REYY-0005", make: "AMO Electric Bikes - Jaunty", chassis: "ADCSYSL250905580" },
  { number: "REYY-0006", make: "Dynamo Electric Bikes - X1", chassis: "R6VA014C0TL007776" },
  { number: "REYY-0007", make: "Dynamo Electric Bikes - X1", chassis: "R6VA014C0TL011385" },
  { number: "REYY-0008", make: "Dynamo Electric Bikes - X1", chassis: "R6VA014C0TL011354" },
  { number: "REYY-0009", make: "Dynamo Electric Bikes - X1", chassis: "R6VA014C0TL011345" },
  { number: "REYY-0010", make: "Dynamo Electric Bikes - X1", chassis: "R6VA014C0TL011359" },
  { number: "REYY-0011", make: "Dynamo Electric Bikes - X1", chassis: "R6VA014C0TL078681" },
  { number: "REYY-0012", make: "Dynamo Electric Bikes - X1", chassis: "R6VA014C0TL078539" },
  { number: "REYY-0013", make: "Dynamo Electric Bikes - X1", chassis: "R6VA014C0TL078433" },
  { number: "REYY-0014", make: "Dynamo Electric Bikes - X1", chassis: "R6VA014C0TL078364" },
  { number: "REYY-0015", make: "Dynamo Electric Bikes - X1", chassis: "R6VA014C0TL078324" },
  { number: "REYY-0016", make: "Dynamo Electric Bikes - X1", chassis: "R6VA014C0TL078171" },
  { number: "REYY-0017", make: "Dynamo Electric Bikes - X1", chassis: "R6VA014C0TL078312" },
  { number: "REYY-0018", make: "Dynamo Electric Bikes - X1", chassis: "R6VA014C0TL078313" },
  { number: "REYY-0019", make: "Dynamo Electric Bikes - X1", chassis: "R6VA014C0TL078349" },
  { number: "REYY-0020", make: "Dynamo Electric Bikes - X1", chassis: "R6VA014C0TL078281" },
  { number: "REYY-0021", make: "Dynamo Electric Bikes - X1", chassis: "R6VA014C0TL078316" },
  { number: "REYY-0022", make: "Dynamo Electric Bikes - X1", chassis: "R6VA014C0TL078346" },
  { number: "REYY-0023", make: "Dynamo Electric Bikes - X1", chassis: "R6VA014C0TL078643" },
  { number: "REYY-0024", make: "Dynamo Electric Bikes - X1", chassis: "R6VA014C0TL078323" },
  { number: "REYY-0025", make: "Dynamo Electric Bikes - X1", chassis: "R6VA014C0TL078347" },
];

const BATTERY_PROVIDER = "Battery Smart";

async function seedOne(v) {
  const id = uuid();
  const now = new Date().toISOString();
  try {
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: TABLE_NAME,
              Item: {
                PK: `VEHICLE#${id}`,
                SK: "PROFILE",
                GSI1PK: "VEHICLES",
                GSI1SK: v.number.toLowerCase(),
                vehicleId: id,
                number: v.number,
                make: v.make,
                chassisNumber: v.chassis,
                batteryProvider: BATTERY_PROVIDER,
                createdAt: now,
              },
              ConditionExpression: "attribute_not_exists(PK)",
            },
          },
          {
            Put: {
              TableName: TABLE_NAME,
              Item: {
                PK: `VEHICLENO#${normalizePlate(v.number)}`,
                SK: "UNIQUE",
                vehicleId: id,
                createdAt: now,
              },
              ConditionExpression: "attribute_not_exists(PK)",
            },
          },
        ],
      })
    );
    console.log(`  added   ${v.number}  (${v.make}, chassis ${v.chassis})`);
    return "added";
  } catch (err) {
    if (err?.name === "TransactionCanceledException") {
      console.log(`  skipped ${v.number}  (already registered)`);
      return "skipped";
    }
    throw err;
  }
}

async function main() {
  console.log(`Seeding ${VEHICLES.length} vehicles into ${TABLE_NAME}…`);
  const counts = { added: 0, skipped: 0 };
  for (const v of VEHICLES) counts[await seedOne(v)]++;
  console.log(`Done. ${counts.added} added, ${counts.skipped} skipped.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
