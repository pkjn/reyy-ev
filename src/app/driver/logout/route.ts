// Driver logout: clears the reyy_driver cookie.
//
// The WebView calls this, then invokes the native app's logout bridge
// (ReactNativeWebView.postMessage or Android.logout) which clears the
// JWT from SecureStore and restarts the app at the login screen.

import { NextResponse } from "next/server";

export async function POST() {
  const response = new NextResponse(null, { status: 204 });
  response.cookies.set("reyy_driver", "", {
    httpOnly: true,
    path: "/driver",
    maxAge: 0,
  });
  return response;
}
