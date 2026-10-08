// Product search for the lists a page already holds (L5): My store's catalog
// and a draft's Add list. A real catalog of thousands would be searched on the
// server instead, behind the same box (ARCHITECTURE.md §9, UX at scale).

/** True when the typed text is part of the name or brand, ignoring case; empty text matches everything. */
export function matchesProduct(product: { name: string; brand: string }, text: string): boolean {
  const typed = text.trim().toLowerCase();
  return !typed || product.name.toLowerCase().includes(typed) || product.brand.toLowerCase().includes(typed);
}
