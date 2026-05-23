import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,svelte}"],
  // Class-based dark mode so a future theme switcher can toggle by adding/removing the
  // `dark` class on <html>. v0 doesn't ship a toggle; we just inherit the OS preference
  // via a media query in app.css.
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        accent: {
          DEFAULT: "#2563eb", // Tailwind blue-600 — distinct from inpax (blue-500) and
          muted: "#1e40af",   // ediabasx-web (cyan-500).
        },
        base: "rgb(var(--theme-bg) / <alpha-value>)",
        surface: "rgb(var(--theme-surface) / <alpha-value>)",
        elevated: "rgb(var(--theme-elevated) / <alpha-value>)",
        divider: "rgb(var(--theme-border-subtle) / <alpha-value>)",
        rule: "rgb(var(--theme-border-strong) / <alpha-value>)",
        foreground: "rgb(var(--theme-text-primary) / <alpha-value>)",
        muted: "rgb(var(--theme-text-secondary) / <alpha-value>)",
        faint: "rgb(var(--theme-text-muted) / <alpha-value>)",
      },
      borderColor: {
        DEFAULT: "rgb(var(--theme-border-subtle) / <alpha-value>)",
      },
      fontFamily: {
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          "monospace",
        ],
      },
    },
  },
  plugins: [],
} satisfies Config;
