import { json } from "../lib/http"

export function handleHealthCheck() {
  return json({
    ok: true,
    service: "lexio-platform-api",
    timestamp: new Date().toISOString(),
  })
}
