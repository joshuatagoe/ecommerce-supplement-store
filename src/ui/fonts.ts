// Fonts under the SIL Open Font License. next/font downloads them at build
// time and serves them from our own origin, so pages make no requests to other
// sites (§9). The patient page's Atkinson Hyperlegible Next arrives with it (M4).
import { Source_Sans_3 } from "next/font/google";

export const sourceSans = Source_Sans_3({ subsets: ["latin"], variable: "--font-source-sans", display: "swap" });
