import type { Env } from "./env"
import { createClerkClient } from "@clerk/backend"
import { toList } from "./env"
import { HttpError } from "./http"

export interface SessionContext {
  clerkUserId: string
  sessionId: string | null
}

export function getClerkClient(env: Env) {
  return createClerkClient({
    secretKey: env.CLERK_SECRET_KEY,
    publishableKey: env.CLERK_PUBLISHABLE_KEY,
  })
}

export async function requireSession(request: Request, env: Env): Promise<SessionContext> {
  const clerk = getClerkClient(env)
  const requestState = await clerk.authenticateRequest(request, {
    acceptsToken: "session_token",
    jwtKey: env.CLERK_JWT_KEY,
    audience: toList(env.CLERK_AUDIENCE),
    authorizedParties: toList(env.CLERK_AUTHORIZED_PARTIES),
  })

  if (!requestState.isAuthenticated) {
    throw new HttpError(401, requestState.message ?? "Authentication required")
  }

  const auth = requestState.toAuth()
  if (!auth.userId) {
    throw new HttpError(401, "Missing user in session token")
  }

  return {
    clerkUserId: auth.userId,
    sessionId: auth.sessionId ?? null,
  }
}
