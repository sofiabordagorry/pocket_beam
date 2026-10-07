import { defineConfig } from "vite";
import { popcorn } from "@swmansion/popcorn/vite";

export default defineConfig({
  build: { outDir: "../dist", emptyOutDir: true, target: "es2022" },
  plugins: [popcorn({ rootDir: "../" })],
});
