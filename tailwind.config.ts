import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        matcha: {
          50: "#f3f7ec",
          100: "#e2ecd0",
          200: "#c6d9a4",
          300: "#a6c376",
          400: "#8aac52",
          500: "#6f8f4a",
          600: "#577339",
          700: "#445830",
          800: "#384929",
          900: "#2f3e25",
        },
        cream: {
          50: "#fdfbf6",
          100: "#faf6ec",
          200: "#f3ecd6",
          300: "#e8dcb6",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      borderRadius: {
        xl: "0.875rem",
        "2xl": "1rem",
      },
      keyframes: {
        flash: {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(111, 143, 74, 0)" },
          "50%": { boxShadow: "0 0 0 4px rgba(111, 143, 74, 0.6)" },
        },
      },
      animation: {
        flash: "flash 1.5s ease-in-out",
      },
    },
  },
  plugins: [],
};

export default config;
