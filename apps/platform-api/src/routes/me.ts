import type { SessionContext } from "../lib/auth"
import type { Env } from "../lib/env"
import { buildMePayload, syncUserFromClerk } from "../lib/db"
import { json } from "../lib/http"

export async function handleMe(_request: Request, env: Env, session: SessionContext) {
  const user = await syncUserFromClerk(env, session)
  return json(await buildMePayload(env, user))
}
