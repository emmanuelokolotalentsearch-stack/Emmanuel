import type { Config } from "tailwindcss";
const config: Config = { content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"], theme: { extend: { colors: { ink: "#17233b", brand: "#6258e8", mist: "#f5f6fb" } } }, plugins: [] };
export default config;
