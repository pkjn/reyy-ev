import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { AUTH_COOKIE, isValidAuthCookie } from "@/lib/auth";

export async function proxy(request: NextRequest) {
  // Gate is disabled when no password is configured (e.g. local dev without
  // SITE_PASSWORD set), so you can't accidentally lock yourself out.
  if (!process.env.SITE_PASSWORD) return NextResponse.next();

  const token = request.cookies.get(AUTH_COOKIE)?.value;
  if (await isValidAuthCookie(token)) return NextResponse.next();

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("from", request.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Run on everything except the login page, the login endpoint, static
  // assets, and driver routes. Driver routes have their own JWT auth and
  // must bypass the site-password gate.
  matcher: [
    "/((?!api/login|api/driver|driver|login|_next/static|_next/image|favicon.ico).*)",
  ],
};
