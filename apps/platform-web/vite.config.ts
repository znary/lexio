import process from "node:process"
import { cloudflare } from "@cloudflare/vite-plugin"
import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv } from "vite"

const REQUIRED_PRODUCTION_ENV_VARS = [
  "VITE_CLERK_PUBLISHABLE_KEY",
  "VITE_PADDLE_CLIENT_TOKEN",
  "VITE_PADDLE_ENV",
  "VITE_PADDLE_PRO_PRICE_ID",
] as const

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "")

  return {
    plugins: [
      react(),
      cloudflare(),
      mode === "production"
        ? {
            name: "validate-platform-web-env",
            buildStart() {
              const missing = REQUIRED_PRODUCTION_ENV_VARS.filter(key => !env[key]?.trim())

              if (missing.length > 0) {
                throw new Error(
                  `\n\nMissing required platform-web environment variables for production:\n`
                  + `${missing.map(key => `   - ${key}`).join("\n")}\n\n`
                  + `Set them before deploying to Cloudflare.\n`,
                )
              }
            },
          }
        : null,
    ].filter(Boolean),
    server: {
      port: 3355,
    },
  }
})
