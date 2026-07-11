// Vehicles are first-class DynamoDB rows (PK=VEHICLE#<id>, SK=PROFILE),
// listed under GSI1PK=VEHICLES. The plate `number` is the join key back to
// rentals: a rental's current `scootyLabel` holds the plate, so a vehicle is
// "assigned" to whichever active rental currently carries its number. Swaps
// update the rental's scootyLabel, so the assignment shown here follows swaps
// with no extra bookkeeping. This file holds the pure types/helpers shared by
// the API routes and the vehicles UI — no AWS imports, so it's safe to import
// into client components.

export interface Vehicle {
  id: string;
  number: string; // registration plate, e.g. "MH12 AB 1234"
  make: string; // e.g. "Ola S1 Pro"
  chassis_number: string;
  battery_provider: string;
  created_at: string;
  // The active rental currently holding this vehicle, if any.
  assignment: VehicleAssignment | null;
  // Latest odometer reading (km), or null if none logged yet.
  latest_km: number | null;
}

// One leg of a vehicle's life: the stretch it spent with one customer, from
// hand-over until it was swapped out / the rental closed (null `to` = still
// out now). Reconstructed from rentals' scooty history — see the vehicle GET.
export interface JourneyLeg {
  rental_id: string;
  customer_id: string;
  customer_name: string;
  from: string; // YYYY-MM-DD handed over
  to: string | null; // YYYY-MM-DD returned/swapped out; null = current
  current: boolean;
  handover_note: string | null; // why it was given to this customer
  return_note: string | null; // why it was swapped out (if it was)
}

// One odometer reading logged against a vehicle.
export interface OdometerReading {
  id: string;
  date: string; // YYYY-MM-DD
  km: number;
  note: string | null;
  created_at: string;
}

export interface VehicleAssignment {
  customer_id: string;
  customer_name: string;
  rental_id: string;
  since: string | null; // YYYY-MM-DD the vehicle was handed to this customer
}

// The vehicle OEMs we currently run. Kept as a fixed list so the add/edit
// forms can offer a dropdown rather than free text — extend this when a new
// model joins the fleet.
export const VEHICLE_MAKES = [
  "AMO Electric Bikes - Jaunty",
  "Dynamo Electric Bikes - X1",
] as const;

// Battery swap networks we work with.
export const BATTERY_PROVIDERS = ["Battery Smart", "Sun Mobility"] as const;

// Collapse whitespace and upper-case so "mh12 ab 1234" and "MH12  AB 1234"
// share one uniqueness marker and can't be added twice.
export function normalizePlate(s: string): string {
  return s.trim().replace(/\s+/g, " ").toUpperCase();
}
