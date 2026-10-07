// Order refs (ARCHITECTURE.md §6): 8 random characters from an alphabet
// without 0, O, 1, I or L, shown as K7Q2-M9XD. Random, so a ref says nothing
// about how many orders exist.
import { randomInt } from "node:crypto";

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function newRef(): string {
  const pick = () => ALPHABET[randomInt(ALPHABET.length)];
  const group = () => Array.from({ length: 4 }, pick).join("");
  return `${group()}-${group()}`;
}
