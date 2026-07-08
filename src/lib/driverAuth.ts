// Driver authentication: phone + password → JWT.
//
// Drivers are existing CUSTOMER#<id> rows; an admin sets
// `driverPasswordHash` (bcrypt) on the profile during onboarding. Login
// looks up the customer by phone via the PHONE# uniqueness row, verifies
// the bcrypt hash, and issues a 90-day HS256 JWT signed with JWT_SECRET.
//
// Phone normalisation: all phones are stored as digits-only with country
// code (e.g. "919876543210"). Input may arrive as "9876543210",
// "+919876543210", or "98 7654 3210" — all normalise to the same form.

import bcrypt from "bcryptjs";
import {
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import ddb, { TABLE_NAME } from "@/lib/db";

const BCRYPT_ROUNDS = 10;

// A fixed dummy hash so that verifyDriverPassword takes constant time even
// when the customer doesn't exist (prevents timing-based phone enumeration).
const DUMMY_HASH = bcrypt.hashSync("__dummy__", BCRYPT_ROUNDS);

// Characters that could be confused at a glance (0/O, 1/l) are excluded
// from generated passwords.
const PASSWORD_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";

// ---------------------------------------------------------------------------
// Phone normalisation
// ---------------------------------------------------------------------------

export function normalisePhone(input: string): string | null {
  // Strip everything that isn't a digit.
  const digits = input.replace(/\D/g, "");

  // 10 digits → Indian mobile, prepend country code.
  if (digits.length === 10 && /^[6-9]/.test(digits)) {
    return `91${digits}`;
  }

  // 12 digits starting with 91 → already has country code.
  if (digits.length === 12 && digits.startsWith("91")) {
    return digits;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Customer lookup by phone
// ---------------------------------------------------------------------------

export async function findCustomerByPhone(
  phone: string
): Promise<{ customerId: string; name: string; phone: string } | null> {
  // Look up the PHONE# uniqueness row to get the customerId.
  const phoneRes = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `PHONE#${phone}`, SK: "UNIQUE" },
    })
  );
  if (!phoneRes.Item) return null;

  const customerId = phoneRes.Item.customerId as string;

  // Fetch the customer profile to get the name.
  const profileRes = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `CUSTOMER#${customerId}`, SK: "PROFILE" },
    })
  );
  if (!profileRes.Item) return null;

  return {
    customerId,
    name: (profileRes.Item.customerName as string) || "",
    phone,
  };
}

// ---------------------------------------------------------------------------
// Password verification
// ---------------------------------------------------------------------------

export async function verifyDriverPassword(
  customerId: string,
  password: string
): Promise<boolean> {
  const res = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `CUSTOMER#${customerId}`, SK: "PROFILE" },
      ProjectionExpression: "driverPasswordHash",
    })
  );

  const hash = (res.Item?.driverPasswordHash as string) || DUMMY_HASH;
  
  // Backward compatibility: try exact match first
  const exactMatch = await bcrypt.compare(password, hash);
  if (exactMatch) return true;

  // Try uppercase match for case-insensitivity
  return bcrypt.compare(password.toUpperCase(), hash);
}

// ---------------------------------------------------------------------------
// Password set (admin action)
// ---------------------------------------------------------------------------

export async function setDriverPassword(
  customerId: string,
  password: string
): Promise<void> {
  // Hash the uppercase version so the driver can login regardless of case
  const hash = await bcrypt.hash(password.toUpperCase(), BCRYPT_ROUNDS);

  // Read the customer profile to get their phone number.
  const profileRes = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `CUSTOMER#${customerId}`, SK: "PROFILE" },
    })
  );
  if (!profileRes.Item) {
    throw new Error("customer not found");
  }

  const phones = (profileRes.Item.phones as string[]) || [];
  if (phones.length === 0) {
    throw new Error("customer has no phone");
  }

  const phone = normalisePhone(phones[0]);
  if (!phone) {
    throw new Error("customer has no valid phone");
  }

  // Transactionally: update profile hash + upsert PHONE# uniqueness row.
  // The condition on the PHONE# row ensures another customer can't steal
  // the phone, but the same customer can re-set their password.
  await ddb.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Update: {
            TableName: TABLE_NAME,
            Key: { PK: `CUSTOMER#${customerId}`, SK: "PROFILE" },
            UpdateExpression: "SET driverPasswordHash = :hash",
            ExpressionAttributeValues: { ":hash": hash },
          },
        },
        {
          Put: {
            TableName: TABLE_NAME,
            Item: {
              PK: `PHONE#${phone}`,
              SK: "UNIQUE",
              customerId,
              createdAt: new Date().toISOString(),
            },
            ConditionExpression:
              "attribute_not_exists(PK) OR customerId = :cid",
            ExpressionAttributeValues: { ":cid": customerId },
          },
        },
      ],
    })
  );
}

// ---------------------------------------------------------------------------
// Active rental lookup
// ---------------------------------------------------------------------------

export async function getActiveRentalForDriver(
  customerId: string
): Promise<{ rentalId: string; scootyLabel: string } | null> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": `CUSTOMER#${customerId}`,
        ":sk": "RENTAL#",
      },
    })
  );

  // Return the first rental without an endDate (active).
  const active = (res.Items || []).find((item) => !item.endDate);
  if (!active) return null;

  // Extract rentalId from SK: "RENTAL#<rid>"
  const rentalId = (active.SK as string).replace("RENTAL#", "");
  return {
    rentalId,
    scootyLabel: (active.scootyLabel as string) || "",
  };
}

// ---------------------------------------------------------------------------
// Password generation (admin)
// ---------------------------------------------------------------------------

export function generatePassword(length = 8): string {
  let result = "";
  for (let i = 0; i < length; i++) {
    result += PASSWORD_CHARS.charAt(
      Math.floor(Math.random() * PASSWORD_CHARS.length)
    );
  }
  return result;
}
