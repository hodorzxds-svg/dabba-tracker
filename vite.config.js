import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Lets `netlify dev` (or a separately running functions server) serve
      // /api/gemini during local development if you don't use `netlify dev`
      // for the whole app.
    },
  },
});
