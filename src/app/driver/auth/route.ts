// Driver auth handoff: token → cookie → redirect.
//
// The native app loads /driver/auth?token=<JWT> once after login. This
// endpoint validates the token, sets an HttpOnly cookie so subsequent
// page navigations in the WebView don't need the Authorization header,
// and redirects to /driver.
//
// The ?token= round-trip happens once per launch and only on the loopback
// to your own domain — no JWT ever crosses to a third party. The cookie is
// HttpOnly so JavaScript in the WebView can't read it.

import { NextResponse } from "next/server";
import { verifyDriverJwt } from "@/lib/jwt";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");

  if (!token) {
    return NextResponse.json(
      { error: "token required" },
      { status: 400 }
    );
  }

  try {
    await verifyDriverJwt(token);
  } catch {
    return NextResponse.json(
      { error: "invalid token" },
      { status: 401 }
    );
  }

  // In development (localhost), we can't set Secure cookies since there's no
  // HTTPS. In production (Vercel), always use Secure.
  const isProduction = process.env.NODE_ENV === "production";

  const response = NextResponse.redirect(new URL("/driver", req.url));
  response.cookies.set("reyy_driver", token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "strict",
    path: "/driver",
    maxAge: 90 * 24 * 60 * 60, // 90 days
  });

  return response;
}
