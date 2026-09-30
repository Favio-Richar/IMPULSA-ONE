import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: [path.join(import.meta.dirname, "vitest.setup.ts")],
  },
});
