import * as path from "path";
import type { Config } from "tailwindcss";
import { cnPreset } from "./src/ui/tailwind.preset";

/* Every design value comes from the commonnotes.net preset. */
export default {
  presets: [cnPreset],
  content: [path.resolve(__dirname, "index.html"), path.resolve(__dirname, "src/**/*.{ts,tsx}")],
} satisfies Config;
