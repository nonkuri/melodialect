import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // preview 環境の autoPort (PORT 環境変数) に従う。未指定なら Vite デフォルト
    port: process.env.PORT ? Number(process.env.PORT) : undefined,
  },
});
