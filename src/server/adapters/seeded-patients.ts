// The seeded stand-in for the EHR's patient list (§3).
import { and, asc, eq, ilike, or } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { patients } from "../db/schema.ts";
import type { PatientDirectory } from "../ports/patient-directory.ts";

// LIKE treats % and _ as wildcards; typed text is matched literally.
const literal = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

export function seededPatients(db: Db): PatientDirectory {
  return {
    async search(practiceId, text) {
      const typed = text.trim();
      if (!typed) return [];
      const prefix = `${literal(typed)}%`;
      const rows = await db
        .select({ id: patients.id, firstName: patients.firstName, lastName: patients.lastName })
        .from(patients)
        .where(
          and(eq(patients.practiceId, practiceId), or(ilike(patients.firstName, prefix), ilike(patients.lastName, prefix))),
        )
        .orderBy(asc(patients.firstName), asc(patients.lastName))
        .limit(10);
      return rows.map((row) => ({ id: row.id, name: `${row.firstName} ${row.lastName}` }));
    },
  };
}
