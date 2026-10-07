// The signed-in provider for this request (ARCHITECTURE.md §10, D32). Pages and
// server actions call these; nothing trusts a provider ID from the browser.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { findProvider, type Provider } from "@/server/access/providers";
import { SESSION_COOKIE, verifySession } from "@/server/access/session";
import { jwtSecret } from "@/server/config";
import { db } from "@/server/db/client";

export const currentProvider = cache(async (): Promise<Provider | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const providerId = await verifySession(token, jwtSecret());
  return providerId ? findProvider(db, providerId) : null;
});

/** The provider, or a redirect to sign-in. */
export async function requireProvider(): Promise<Provider> {
  const provider = await currentProvider();
  if (!provider) redirect("/sign-in");
  return provider;
}
