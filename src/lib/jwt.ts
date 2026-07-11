// Driver authentication: JWT helpers.
//
// Signs and verifies HS256 JWTs for the driver app. Tokens carry the
// customer ID, name, and normalised phone. Issued for 90 days; on expiry
// the native shell shows the login screen and the driver re-authenticates.
// Refresh tokens are intentionally omitted at v1 — the 90-day window is
// generous enough for the delivery-driver use case.

import { SignJWT, jwtVerify } from "jose";

export interface DriverJwtClaims {
  sub: string;        // customerId
  name: string;
  phone: string;
  iat: number;
  exp: number;
  iss: "reyy-ev";
  aud: "driver-app";
}

const JWT_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET env var is not set");
  return new TextEncoder().encode(secret);
}

export async function signDriverJwt(
  claims: Pick<DriverJwtClaims, "sub" | "name" | "phone">
): Promise<string> {
  return new SignJWT({
    sub: claims.sub,
    name: claims.name,
    phone: claims.phone,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("reyy-ev")
    .setAudience("driver-app")
    .setIssuedAt()
    .setExpirationTime(`${JWT_TTL_SECONDS}s`)
    .sign(getSecret());
}

export async function verifyDriverJwt(token: string): Promise<DriverJwtClaims> {
  const { payload } = await jwtVerify(token, getSecret(), {
    issuer: "reyy-ev",
    audience: "driver-app",
  });
  return payload as unknown as DriverJwtClaims;
}
