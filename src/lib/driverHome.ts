// Driver home page payload builder.
//
// Aggregates a driver's profile, active rental, payments, and deposits into
// a single JSON shape that the /driver page and /api/driver/me endpoint both
// use. Reuses computeRentalBalances from billing.ts for rent math, and sums
// DEPOSIT# rows for the collected-vs-target deposit breakdown.

import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import ddb, { TABLE_NAME } from "@/lib/db";
import { computeRentalBalances } from "@/lib/billing";

export interface DriverHomePayload {
  customer_id: string;
  customer_name: string;
  phone: string;
  rental: {
    id: string;
    scooty_label: string;
    start_date: string;
    rate: number;
    rate_unit: string;
    weekly_rent: number;
    security_deposit: number;
    deposit_collected: number;
    deposit_pending: number;
    total_paid: number;
    outstanding: number;
    paid_through: string | null;
    days_remaining: number;
    coverage_status: string;
  };
  support_phone: string | null;
}

export async function buildDriverHomePayload(
  customerId: string
): Promise<DriverHomePayload | null> {
  // Fetch all rows under this customer in a single Query — profile, rentals,
  // payments, deposits all share PK = CUSTOMER#<cid>.
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: {
        ":pk": `CUSTOMER#${customerId}`,
      },
    })
  );

  const items = res.Items || [];
  if (items.length === 0) return null;

  // Find profile.
  const profile = items.find((i) => i.SK === "PROFILE");
  if (!profile) return null;

  // Find active rental (no endDate).
  const rental = items.find(
    (i) =>
      typeof i.SK === "string" &&
      (i.SK as string).startsWith("RENTAL#") &&
      !i.endDate
  );
  if (!rental) return null;

  const rentalId = (rental.SK as string).replace("RENTAL#", "");

  // Collect payments for this rental.
  const payments = items
    .filter(
      (i) =>
        typeof i.SK === "string" &&
        (i.SK as string).startsWith(`PAYMENT#${rentalId}#`)
    )
    .map((p) => ({ amount: (p.amount as number) || 0 }));

  // Collect deposits for this rental.
  const deposits = items.filter(
    (i) =>
      typeof i.SK === "string" &&
      (i.SK as string).startsWith(`DEPOSIT#${rentalId}`)
  );
  const depositCollected = deposits.reduce(
    (sum, d) => sum + ((d.amount as number) || 0),
    0
  );

  const balances = computeRentalBalances(
    {
      startDate: rental.startDate as string,
      endDate: (rental.endDate as string) || null,
      rate: rental.rate as number,
      rateUnit: rental.rateUnit as "day" | "week" | "month",
    },
    payments
  );

  const securityDeposit = (rental.securityDeposit as number) || 0;

  // Compute a "weekly rent" display value regardless of the actual rate unit.
  const rate = rental.rate as number;
  const rateUnit = rental.rateUnit as string;
  let weeklyRent = rate;
  if (rateUnit === "day") weeklyRent = rate * 7;
  else if (rateUnit === "month") weeklyRent = Math.round((rate / 30) * 7);

  const phones = (profile.phones as string[]) || [];

  return {
    customer_id: customerId,
    customer_name: (profile.customerName as string) || "",
    phone: phones[0] || "",
    rental: {
      id: rentalId,
      scooty_label: (rental.scootyLabel as string) || "",
      start_date: rental.startDate as string,
      rate,
      rate_unit: rateUnit,
      weekly_rent: weeklyRent,
      security_deposit: securityDeposit,
      deposit_collected: depositCollected,
      deposit_pending: Math.max(0, securityDeposit - depositCollected),
      total_paid: balances.totalPaid,
      outstanding: balances.outstanding,
      paid_through: balances.paidThroughDate,
      days_remaining: balances.daysRemaining,
      coverage_status: balances.coverageStatus,
    },
    support_phone: process.env.SUPPORT_PHONE || null,
  };
}
