import { defineConfig } from "vitest/config";
import * as path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@vigie/core": path.resolve(__dirname, "packages/core/src/index.ts"),
      "@vigie/garde": path.resolve(__dirname, "packages/garde/src/index.ts"),
      "@vigie/diagnostic": path.resolve(__dirname, "packages/diagnostic/src/index.ts"),
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/api/test/**/*.test.ts"],
    environment: "node",
  },
});
