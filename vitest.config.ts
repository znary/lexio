import process from "node:process"
import react from "@vitejs/plugin-react"
import { configDefaults, defineConfig } from "vitest/config"

import { WxtVitest } from "wxt/testing"

const freeApiTestFile = "src/utils/host/translate/api/__tests__/free-api.test.ts"
const shouldRunFreeApiTests = process.env.RUN_FREE_API_TESTS === "true"

export default defineConfig({
  // TODO: remove any
  plugins: [WxtVitest() as any, react()],
  test: {
    exclude: [
      ...configDefaults.exclude,
      "**/.claude/**",
      "**/repos/**",
      ...(!shouldRunFreeApiTests ? [freeApiTestFile] : []),
    ],
    environment: "node",
    globals: true,
    setupFiles: "vitest.setup.ts",
    watch: false,
    coverage: {
      provider: "istanbul",
      reporter: ["text", "html", "lcov"],
      // include: ['src/**/*.{ts,tsx}'],
      // exclude: ['src/**/*.spec.ts']
    },
  },
})
