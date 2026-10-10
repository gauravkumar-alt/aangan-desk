import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // server-only throws outside a React Server Component build; tests run the server code directly.
      "server-only": path.resolve(__dirname, "tests/server-only-stub.ts"),
    },
  },
  test: { environment: "node", include: ["tests/**/*.test.ts"], testTimeout: 20000 },
});
