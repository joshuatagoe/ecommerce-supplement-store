// The demo's people and products. Patients stand in for the EHR's patient list
// (§3 Stubs); every email is at example.com, which can't receive mail.

export type CatalogSeed = {
  slug: string;
  brand: string;
  name: string;
  sizeLabel: string;
  msrpCents: number;
  /** Where the retail price came from, and when. */
  source: string;
};

type PatientSeed = { firstName: string; lastName: string; email: string };

type StoreSeed = { name: string; usualPriceCents: number | "lowest" };

type PracticeSeed = {
  name: string;
  timeZone: string;
  provider: { displayName: string; store: StoreSeed[] };
  patients: PatientSeed[];
};

function patient(firstName: string, lastName: string): PatientSeed {
  return { firstName, lastName, email: `${firstName}.${lastName}@example.com`.toLowerCase() };
}

// Real products and the retail prices their brands list on their own US sites,
// checked 2026-10-07 (D15). Our cost is half the retail price (PROBLEM_SPACE.md).
export const CATALOG: CatalogSeed[] = [
  {
    // The running example in every doc. The brand lists this product as
    // Magnesium Bisglycinate at $39.99; it is shown at $40.00 so the demo
    // matches the docs' numbers (assumption A6).
    slug: "magnesium-glycinate",
    brand: "Designs for Health",
    name: "Magnesium Glycinate",
    sizeLabel: "120 capsules",
    msrpCents: 4000,
    source: "designsforhealth.com/products/magnesium-bisglycinate ($39.99), 2026-10-07",
  },
  {
    slug: "vitamin-d-k2-liquid",
    brand: "Thorne",
    name: "Vitamin D + K2 Liquid",
    sizeLabel: "1,200 drops",
    msrpCents: 3400,
    source: "thorne.com/products/dp/vitamin-d-k2-liquid, 2026-10-07",
  },
  {
    slug: "ultimate-omega",
    brand: "Nordic Naturals",
    name: "Ultimate Omega",
    sizeLabel: "60 soft gels",
    msrpCents: 2995,
    source: "nordic.com/products/ultimate-omega, 2026-10-07",
  },
  {
    slug: "nordic-flora-probiotic-daily",
    brand: "Nordic Naturals",
    name: "Nordic Flora Probiotic Daily",
    sizeLabel: "60 capsules",
    msrpCents: 3095,
    source: "nordic.com/products/nordic-flora-probiotic-daily, 2026-10-07",
  },
  {
    slug: "active-b-complex",
    brand: "Integrative Therapeutics",
    name: "Active B-Complex",
    sizeLabel: "60 capsules",
    msrpCents: 1825,
    source: "integrativepro.com/products/active-b-complex, 2026-10-07",
  },
  {
    slug: "complete-multi",
    brand: "Designs for Health",
    name: "Complete Multi",
    sizeLabel: "120 capsules",
    msrpCents: 6799,
    source: "designsforhealth.com/products/dfh-complete-multi, 2026-10-07",
  },
  {
    slug: "zinc-picolinate",
    brand: "Thorne",
    name: "Zinc Picolinate 30 mg",
    sizeLabel: "60 capsules",
    msrpCents: 2000,
    source: "thorne.com/products/dp/zinc-picolinate-30mg, 2026-10-07",
  },
  {
    slug: "theracurmin-hp",
    brand: "Integrative Therapeutics",
    name: "Theracurmin HP",
    sizeLabel: "60 capsules",
    msrpCents: 5600,
    source: "integrativepro.com/products/theracurmin-hp, 2026-10-07",
  },
];

export const PRACTICES: PracticeSeed[] = [
  {
    // The running example (ARCHITECTURE.md): Dr. Rivera sells at a margin.
    name: "Lakeview Family Practice",
    timeZone: "America/Los_Angeles",
    provider: {
      displayName: "Dr. Rivera",
      // Margin prices a little under retail. Three products are left out, so the demo can add one.
      store: [
        { name: "Magnesium Glycinate", usualPriceCents: 3600 },
        { name: "Vitamin D + K2 Liquid", usualPriceCents: 3100 },
        { name: "Ultimate Omega", usualPriceCents: 2700 },
        { name: "Active B-Complex", usualPriceCents: 1650 },
        { name: "Theracurmin HP", usualPriceCents: 5000 },
      ],
    },
    patients: [
      patient("Sam", "Okafor"),
      patient("Maria", "Gonzalez"),
      patient("James", "Whitfield"),
      patient("Priya", "Raman"),
      patient("Eleanor", "Brooks"),
      patient("Daniel", "Kim"),
    ],
  },
  {
    // An at-cost provider (USERS.md): every usual price is the no-profit price.
    name: "Harbor Integrative Health",
    timeZone: "America/New_York",
    provider: {
      displayName: "Dr. Patel",
      store: [
        { name: "Magnesium Glycinate", usualPriceCents: "lowest" },
        { name: "Vitamin D + K2 Liquid", usualPriceCents: "lowest" },
        { name: "Nordic Flora Probiotic Daily", usualPriceCents: "lowest" },
        { name: "Complete Multi", usualPriceCents: "lowest" },
        { name: "Zinc Picolinate 30 mg", usualPriceCents: "lowest" },
      ],
    },
    patients: [
      patient("Olivia", "Martin"),
      patient("Marcus", "Johnson"),
      patient("Grace", "Liu"),
      patient("Henry", "Adams"),
      patient("Fatima", "Hassan"),
      patient("Robert", "Nguyen"),
    ],
  },
];
