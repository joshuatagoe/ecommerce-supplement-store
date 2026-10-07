// Who is calling (ARCHITECTURE.md §3 Access). The fake login lists every
// provider; the real one would ask the practice's identity service (D32).
import { asc, eq } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { practices, providers } from "../db/schema.ts";

export type Provider = {
  id: string;
  displayName: string;
  practiceId: string;
  practiceName: string;
  timeZone: string;
};

const columns = {
  id: providers.id,
  displayName: providers.displayName,
  practiceId: providers.practiceId,
  practiceName: practices.name,
  timeZone: practices.timeZone,
};

export async function listProviders(db: Db): Promise<Provider[]> {
  return db
    .select(columns)
    .from(providers)
    .innerJoin(practices, eq(practices.id, providers.practiceId))
    .orderBy(asc(practices.name), asc(providers.displayName));
}

export async function findProvider(db: Db, providerId: string): Promise<Provider | null> {
  const [provider] = await db
    .select(columns)
    .from(providers)
    .innerJoin(practices, eq(practices.id, providers.practiceId))
    .where(eq(providers.id, providerId));
  return provider ?? null;
}
