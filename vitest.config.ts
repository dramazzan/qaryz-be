import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@/lib": path.resolve(__dirname, "./src/lib"),
      "@/backend": path.resolve(__dirname, "./src"),
      "@": path.resolve(__dirname, "./src")
    }
  },
  test: {
    environment: "node"
  }
});
