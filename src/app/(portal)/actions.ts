"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { findProvider } from "@/server/access/providers";
import { SESSION_COOKIE, SESSION_COOKIE_OPTIONS, signSession } from "@/server/access/session";
import { jwtSecret } from "@/server/config";
import { db } from "@/server/db/client";
import { type ActionResult, parseInput, signInInput } from "@/shared/schemas";

/** The fake login (§8 signIn): any listed provider, with a real signed cookie. */
export async function signIn(_previous: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = parseInput(signInInput, { providerId: form.get("providerId") });
  const provider = parsed.ok ? await findProvider(db, parsed.data.providerId) : null;
  if (!provider) {
    return {
      ok: false,
      error: { code: "UNKNOWN_PROVIDER", message: "That provider isn't in this demo. Choose one from the list." },
    };
  }
  (await cookies()).set(SESSION_COOKIE, await signSession(provider.id, jwtSecret()), SESSION_COOKIE_OPTIONS);
  redirect("/store");
}

export async function signOut(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/sign-in");
}
