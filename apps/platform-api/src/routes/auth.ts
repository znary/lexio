import type { SessionContext } from "../lib/auth"
import type { Env } from "../lib/env"
import { mintExtensionToken } from "../lib/auth"
import { syncUserFromClerk } from "../lib/db"
import { HttpError, json } from "../lib/http"

export async function handleExchangeExtensionToken(_request: Request, env: Env, session: SessionContext) {
  if (session.tokenType !== "clerk") {
    throw new HttpError(403, "Extension token exchange requires a Clerk session.")
  }

  const user = await syncUserFromClerk(env, session)
  const nextSession = await mintExtensionToken(session, env)

  return json({
    token: nextSession.token,
    expiresAt: nextSession.expiresAt,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      imageUrl: user.avatarUrl,
    },
  })
}
