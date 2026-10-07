// Fonts under the SIL Open Font License. next/font downloads them at build
// time and serves them from our own origin, so pages make no requests to other
// sites (§9).
import { Atkinson_Hyperlegible_Next, Source_Sans_3 } from "next/font/google";

export const sourceSans = Source_Sans_3({ subsets: ["latin"], variable: "--font-source-sans", display: "swap" });

// The patient page's font, designed for low-vision readers. Next.js has no
// fallback metrics for it, so it doesn't try to build a size-matched fallback.
export const atkinson = Atkinson_Hyperlegible_Next({
  subsets: ["latin"],
  variable: "--font-atkinson",
  display: "swap",
  adjustFontFallback: false,
});
