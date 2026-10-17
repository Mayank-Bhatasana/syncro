/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#1E1B2E",
        paper: "#FFF6E6",
        sun: "#FFD84D",
        bubble: "#FF7AB2",
        azure: "#7CC8FF",
        mint: "#6BE3B0",
        grape: "#B99BFF",
        tangerine: "#FF9B54",
      },
      fontFamily: {
        display: [
          '"Bricolage Grotesque"',
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
        body: ['"DM Sans"', "ui-sans-serif", "system-ui", "sans-serif"],
      },
      boxShadow: {
        "pop-sm": "2px 2px 0 0 #1E1B2E",
        pop: "4px 4px 0 0 #1E1B2E",
        "pop-lg": "8px 8px 0 0 #1E1B2E",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "pop-in": {
          from: { opacity: "0", transform: "scale(0.92) rotate(-1deg)" },
          to: { opacity: "1", transform: "scale(1) rotate(0deg)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.25s ease-out",
        "pop-in": "pop-in 0.22s cubic-bezier(0.34, 1.56, 0.64, 1)",
      },
    },
  },
  plugins: [],
};
