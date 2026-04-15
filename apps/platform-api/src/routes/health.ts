import type { Env } from "../lib/env"
import { buildPublicEnvDiagnostics } from "../lib/env-diagnostics"
import { json } from "../lib/http"

export function handleHealthCheck(env: Env) {
  return json({
    ok: true,
    service: "lexio-platform-api",
    timestamp: new Date().toISOString(),
    envDiagnostics: buildPublicEnvDiagnostics(env),
  })
}
