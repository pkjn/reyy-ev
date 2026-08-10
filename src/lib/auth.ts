// Simple single-password site gate.
//
// The auth cookie stores a SHA-256 hash of the configured password (never the
// password itself). Validation is stateless: recompute the hash from
// SITE_PASSWORD and compare. Uses the Web Crypto API so it works in both the
// Node.js and Edge runtimes (Proxy + Route Handlers).

export const AUTH_COOKIE = "reyy_auth";

export async function hashPassword(password: string): Promise<string> {
  const data = new TextEncoder().encode(`reyy-ev::${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function isValidAuthCookie(
  value: string | undefined
): Promise<boolean> {
  const password = process.env.SITE_PASSWORD;
  if (!password || !value) return false;
  return value === (await hashPassword(password));
}
