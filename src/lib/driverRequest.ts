// Shared driver request helper: extracts and verifies the JWT from incoming
// requests. Checks the Authorization header first (native app), then falls
// back to the reyy_driver cookie (WebView after auth handoff).

import { cookies } from "next/headers";
import { verifyDriverJwt, DriverJwtClaims } from "@/lib/jwt";

export async function requireDriverJwt(
  req: Request
): Promise<DriverJwtClaims> {
  // 1. Try Authorization: Bearer <token> header.
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    return verifyDriverJwt(token);
  }

  // 2. Fall back to the reyy_driver cookie (set by /driver/auth handoff).
  const cookieStore = await cookies();
  const cookieToken = cookieStore.get("reyy_driver")?.value;
  if (cookieToken) {
    return verifyDriverJwt(cookieToken);
  }

  throw new Error("unauthorized");
}
