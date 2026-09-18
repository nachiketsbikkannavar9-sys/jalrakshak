/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#05070d",
          900: "#0a0f1a",
          850: "#0d1424",
          800: "#111a2e",
          700: "#1a2740",
          600: "#24344f",
        },
        line: { DEFAULT: "#22304a", dim: "#131f37" },
        accent: { DEFAULT: "#22d3ee", dim: "#0e7490" },
        risk: {
          normal: "#34d399",
          watch: "#fbbf24",
          warning: "#fb923c",
          severe: "#f87171",
          critical: "#e879f9",
        },
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', "system-ui", "sans-serif"],
        mono: ['"IBM Plex Mono"', "ui-monospace", "monospace"],
      },
      boxShadow: {
        card: "0 1px 0 rgba(255,255,255,.05) inset, 0 10px 28px rgba(0,0,0,.4)",
        glow: "0 0 0 1px rgba(34,211,238,.25), 0 0 24px rgba(34,211,238,.15)",
      },
    },
  },
  plugins: [],
};