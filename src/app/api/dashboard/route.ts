import { NextResponse } from "next/server";
import ddb, { TABLE_NAME } from "@/lib/db";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { computeRentalBalances, Rental, readPauses } from "@/lib/billing";

// GET /api/dashboard — surfaces customers who need attention.
//
// With the advance-payment model, "rent due" is no longer the headline metric.
// What matters is whether a rental's paid coverage has run out. We bucket
// active rentals by coverageStatus:
//   * BLOCK     — paid period has ended, customer hasn't renewed
//   * Due today — today is the last paid day; collect before EOD
//   * Paid up   — still has paid days ahead
export async function GET() {
  const [custRes, rentRes] = await Promise.all([
    ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :pk",
        ExpressionAttributeValues: { ":pk": "CUSTOMERS" },
      })
    ),
    ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :pk",
        ExpressionAttributeValues: { ":pk": "RENTALS" },
      })
    ),
  ]);

  const customerById = new Map<
    string,
    { name: string; phones: string[] }
  >();
  for (const c of custRes.Items || []) {
    const phones = Array.isArray(c.phones)
      ? (c.phones as string[])
      : typeof c.phone === "string" && (c.phone as string).trim()
        ? [c.phone as string]
        : [];
    customerById.set(c.customerId as string, {
      name: c.name as string,
      phones,
    });
  }

  const rentals = rentRes.Items || [];

  const paymentsByRental = new Map<string, { amount: number }[]>();
  // How much of each rental's security deposit has actually been collected
  // (it may arrive in installments — sum every DEPOSIT#<rid>#... row).
  const depositCollectedByRental = new Map<string, number>();
  await Promise.all(
    rentals.map(async (r) => {
      const rid = r.rentalId as string;
      // Payments and deposits now project into their account's GSI1 partition,
      // so fetch a rental's rows from the base table by their SK prefix.
      const [payRes, depRes] = await Promise.all([
        ddb.send(
          new QueryCommand({
            TableName: TABLE_NAME,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues: {
              ":pk": `CUSTOMER#${r.customerId as string}`,
              ":sk": `PAYMENT#${rid}#`,
            },
          })
        ),
        ddb.send(
          new QueryCommand({
            TableName: TABLE_NAME,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            // No trailing # so legacy DEPOSIT#<rid> rows match too.
            ExpressionAttributeValues: {
              ":pk": `CUSTOMER#${r.customerId as string}`,
              ":sk": `DEPOSIT#${rid}`,
            },
          })
        ),
      ]);
      paymentsByRental.set(
        rid,
        (payRes.Items || []).map((p) => ({ amount: p.amount as number }))
      );
      depositCollectedByRental.set(
        rid,
        (depRes.Items || []).reduce((s, d) => s + ((d.amount as number) || 0), 0)
      );
    })
  );

  const now = new Date();
  let activeRentals = 0;
  type RentalEntry = {
    customer_id: string;
    customer_name: string;
    customer_phones: string[];
    rental_id: string;
    scooty_label: string;
    paid_through: string | null;
    days_remaining: number; // negative when overdue
  };
  const blockedItems: RentalEntry[] = [];
  const dueTodayItems: RentalEntry[] = [];
  const paidUpItems: RentalEntry[] = [];

  // Active rentals whose security deposit isn't fully collected yet (e.g. a
  // new customer paying it off in weekly installments) — money still owed.
  type DepositEntry = {
    customer_id: string;
    customer_name: string;
    customer_phones: string[];
    rental_id: string;
    scooty_label: string;
    deposit_target: number;
    deposit_collected: number;
    deposit_pending: number;
  };
  const depositPendingItems: DepositEntry[] = [];

  for (const r of rentals) {
    const rental: Rental = {
      id: r.rentalId as string,
      customerId: r.customerId as string,
      customerName: r.customerName as string,
      scootyLabel: r.scootyLabel as string,
      startDate: r.startDate as string,
      endDate: (r.endDate as string) || null,
      rate: r.rate as number,
      rateUnit: r.rateUnit as Rental["rateUnit"],
      securityDeposit: (r.securityDeposit as number) || 0,
      refundableDeposit: (r.refundableDeposit as number) || 0,
      notes: null,
      pauses: readPauses(r),
      createdAt: r.createdAt as string,
    };
    if (rental.endDate) continue; // closed — skip from active dashboard
    activeRentals++;

    const payments = paymentsByRental.get(rental.id) || [];
    const balances = computeRentalBalances(rental, payments, now);
    const customerInfo = customerById.get(rental.customerId);
    const entry: RentalEntry = {
      customer_id: rental.customerId,
      customer_name: rental.customerName || customerInfo?.name || "",
      customer_phones: customerInfo?.phones || [],
      rental_id: rental.id,
      scooty_label: rental.scootyLabel,
      paid_through: balances.paidThroughDate,
      days_remaining: balances.daysRemaining,
    };

    if (balances.coverageStatus === "overdue") blockedItems.push(entry);
    else if (balances.coverageStatus === "due_today") dueTodayItems.push(entry);
    else paidUpItems.push(entry);

    const depositCollected = depositCollectedByRental.get(rental.id) || 0;
    const depositPending = rental.securityDeposit - depositCollected;
    if (depositPending > 0) {
      depositPendingItems.push({
        customer_id: rental.customerId,
        customer_name: rental.customerName || customerInfo?.name || "",
        customer_phones: customerInfo?.phones || [],
        rental_id: rental.id,
        scooty_label: rental.scootyLabel,
        deposit_target: rental.securityDeposit,
        deposit_collected: depositCollected,
        deposit_pending: depositPending,
      });
    }
  }

  // BLOCK: longest unpaid first (most negative days first).
  blockedItems.sort((a, b) => a.days_remaining - b.days_remaining);
  // Paid-up: soonest expiry first so the user knows who'll need to renew next.
  paidUpItems.sort((a, b) => a.days_remaining - b.days_remaining);
  // Deposit pending: most still owed first.
  depositPendingItems.sort((a, b) => b.deposit_pending - a.deposit_pending);

  return NextResponse.json({
    customer_count: customerById.size,
    active_rentals: activeRentals,
    blocked_count: blockedItems.length,
    due_today_count: dueTodayItems.length,
    paid_up_count: paidUpItems.length,
    deposit_pending_count: depositPendingItems.length,
    deposit_pending_total: depositPendingItems.reduce(
      (s, d) => s + d.deposit_pending,
      0
    ),
    blocked: blockedItems,
    due_today: dueTodayItems,
    paid_up: paidUpItems,
    deposit_pending: depositPendingItems,
  });
}
