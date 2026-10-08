// Gives every request an ID (ARCHITECTURE.md §11, D85). The app reads it from
// the request's headers and puts it on the log lines that request writes, and
// the browser gets it back in a response header, so a problem someone reports
// can be matched to its lines in the log. It's always made here, never taken
// from the caller, so nothing outside can write into our logs through it.
import { type NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  const id = crypto.randomUUID();
  const headers = new Headers(request.headers);
  headers.set("x-request-id", id);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("x-request-id", id);
  return response;
}

export const config = {
  // Every page, action and API route; not the built assets, images or fonts.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)"],
};
