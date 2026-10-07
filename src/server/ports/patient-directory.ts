// PatientDirectory (ARCHITECTURE.md §3): the EHR's patient list. Seeded in the
// slice; a real EHR integration plugs in here. Searches stay inside one
// practice, and their text is never logged (§10).

export type PatientMatch = { id: string; name: string };

export interface PatientDirectory {
  /** Patients whose first or last name starts with the text. Empty text finds no one. */
  search(practiceId: string, text: string): Promise<PatientMatch[]>;
}
