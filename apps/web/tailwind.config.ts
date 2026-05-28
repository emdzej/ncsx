import type { Config } from "tailwindcss";
import bimmerzPreset from "@emdzej/bimmerz-theme";

// Token names (bg-base/surface/elevated, text-foreground/muted/faint,
// border-divider/rule, fontFamily.mono) + light/dark behaviour come
// from the shared @emdzej/bimmerz-theme preset. The CSS variables
// they reference are imported into app.css via
// `@import "@emdzej/bimmerz-theme/tokens.css"`.
//
// This config only adds the per-app accent — ncsx is blue-600,
// distinct from inpax (blue-500) and ediabasx (cyan-500). Everything
// else inherits from the preset to keep the bimmerz family aligned.
export default {
  content: [
    "./index.html",
    "./src/**/*.{ts,svelte}",
    // Shared @emdzej/ediabasx-web-ui components live in node_modules —
    // Tailwind's JIT needs to scan their source so the utility classes
    // they reference actually get generated.
    "../../node_modules/@emdzej/ediabasx-web-ui/src/**/*.{ts,svelte}",
  ],
  presets: [bimmerzPreset],
  theme: {
    extend: {
      colors: {
        accent: {
          DEFAULT: "#2563eb",
          muted: "#1e40af",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
