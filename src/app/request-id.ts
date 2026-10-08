// The ID proxy.ts gave this request (ARCHITECTURE.md §11, D85), for the
// contexts that pages and actions build, so their log lines carry it.
import { headers } from "next/headers";

export async function requestId(): Promise<string | undefined> {
  return (await headers()).get("x-request-id") ?? undefined;
}
