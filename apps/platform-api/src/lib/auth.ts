import type { Env } from "./env"
import { createClerkClient } from "@clerk/backend"
import { z } from "zod"
import { toList } from "./env"
import { HttpError } from "./http"

const EXTENSION_TOKEN_PREFIX = "lxp1"
const EXTENSION_TOKEN_ISSUER = "lexio-platform-api"
const EXTENSION_TOKEN_AUDIENCE = "lexio-extension"
const EXTENSION_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30
const MAX_CLOCK_SKEW_SECONDS = 30
const textEncoder = new TextEncoder()
const BASE64URL_PLUS_RE = /\+/g
const BASE64URL_SLASH_RE = /\//g
const BASE64URL_PADDING_RE = /=+$/g
const BASE64URL_DASH_RE = /-/g
const BASE64URL_UNDERSCORE_RE = /_/g

export interface SessionContext {
  clerkUserId: string
  sessionId: string | null
  tokenType: "clerk" | "extension"
}

export function getClerkClient(env: Env) {
  return createClerkClient({
    secretKey: env.CLERK_SECRET_KEY,
    publishableKey: env.CLERK_PUBLISHABLE_KEY,
  })
}

const extensionTokenPayloadSchema = z.object({
  iss: z.literal(EXTENSION_TOKEN_ISSUER),
  aud: z.literal(EXTENSION_TOKEN_AUDIENCE),
  sub: z.string().min(1),
  sid: z.string().nullable().optional(),
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
})

function toBase64Url(value: Uint8Array): string {
  let binary = ""
  for (const byte of value) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary)
    .replace(BASE64URL_PLUS_RE, "-")
    .replace(BASE64URL_SLASH_RE, "_")
    .replace(BASE64URL_PADDING_RE, "")
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value
    .replace(BASE64URL_DASH_RE, "+")
    .replace(BASE64URL_UNDERSCORE_RE, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=")
  const binary = atob(normalized)

  return Uint8Array.from(binary, char => char.charCodeAt(0))
}

function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false
  }

  let result = 0
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }

  return result === 0
}

function getExtensionTokenSecret(env: Env): string {
  return env.PLATFORM_EXTENSION_TOKEN_SECRET?.trim() || env.CLERK_SECRET_KEY
}

async function signExtensionTokenPayload(payloadSegment: string, env: Env): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(getExtensionTokenSecret(env)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const signatureBuffer = await crypto.subtle.sign("HMAC", cryptoKey, textEncoder.encode(payloadSegment))
  return toBase64Url(new Uint8Array(signatureBuffer))
}

function getBearerToken(request: Request): string | null {
  const authorization = request.headers.get("Authorization") ?? request.headers.get("authorization")
  if (!authorization) {
    return null
  }

  if (!authorization.toLowerCase().startsWith("bearer ")) {
    return null
  }

  return authorization.slice(7).trim() || null
}

export async function mintExtensionToken(session: Pick<SessionContext, "clerkUserId" | "sessionId">, env: Env): Promise<{ token: string, expiresAt: string }> {
  const issuedAt = Math.floor(Date.now() / 1000)
  const payload = {
    iss: EXTENSION_TOKEN_ISSUER,
    aud: EXTENSION_TOKEN_AUDIENCE,
    sub: session.clerkUserId,
    sid: session.sessionId,
    iat: issuedAt,
    exp: issuedAt + EXTENSION_TOKEN_TTL_SECONDS,
  }
  const payloadSegment = toBase64Url(textEncoder.encode(JSON.stringify(payload)))
  const signatureSegment = await signExtensionTokenPayload(payloadSegment, env)

  return {
    token: `${EXTENSION_TOKEN_PREFIX}.${payloadSegment}.${signatureSegment}`,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
  }
}

export async function verifyExtensionToken(token: string, env: Env): Promise<SessionContext> {
  const [prefix, payloadSegment, signatureSegment, ...rest] = token.split(".")
  if (prefix !== EXTENSION_TOKEN_PREFIX || !payloadSegment || !signatureSegment || rest.length > 0) {
    throw new HttpError(401, "Invalid platform token")
  }

  const expectedSignature = await signExtensionTokenPayload(payloadSegment, env)
  if (!safeEqual(signatureSegment, expectedSignature)) {
    console.warn("[platform-api] Extension token signature check failed")
    throw new HttpError(401, "Invalid platform token")
  }

  let decodedPayload: unknown
  try {
    decodedPayload = JSON.parse(new TextDecoder().decode(fromBase64Url(payloadSegment))) as unknown
  }
  catch {
    throw new HttpError(401, "Invalid platform token payload")
  }

  const parsedPayload = extensionTokenPayloadSchema.safeParse(decodedPayload)
  if (!parsedPayload.success) {
    throw new HttpError(401, "Invalid platform token payload")
  }

  const now = Math.floor(Date.now() / 1000)
  if (parsedPayload.data.exp <= now) {
    console.warn("[platform-api] Extension token expired")
    throw new HttpError(401, "Platform session expired. Sign in again.")
  }

  if (parsedPayload.data.iat > now + MAX_CLOCK_SKEW_SECONDS) {
    throw new HttpError(401, "Invalid platform token issue time")
  }

  return {
    clerkUserId: parsedPayload.data.sub,
    sessionId: parsedPayload.data.sid ?? null,
    tokenType: "extension",
  }
}

export async function requireSession(request: Request, env: Env): Promise<SessionContext> {
  const bearerToken = getBearerToken(request)
  if (bearerToken?.startsWith(`${EXTENSION_TOKEN_PREFIX}.`)) {
    return verifyExtensionToken(bearerToken, env)
  }

  const clerk = getClerkClient(env)
  const requestState = await clerk.authenticateRequest(request, {
    acceptsToken: "session_token",
    jwtKey: env.CLERK_JWT_KEY,
    audience: toList(env.CLERK_AUDIENCE),
    authorizedParties: toList(env.CLERK_AUTHORIZED_PARTIES),
  })

  const authErrorMessage = requestState.message?.trim() || "Authentication required"
  if (!requestState.isAuthenticated) {
    console.warn("[platform-api] Clerk authentication failed", authErrorMessage)
    throw new HttpError(401, authErrorMessage)
  }

  const auth = requestState.toAuth()
  if (!auth.userId) {
    throw new HttpError(401, "Missing user in session token")
  }

  return {
    clerkUserId: auth.userId,
    sessionId: auth.sessionId ?? null,
    tokenType: "clerk",
  }
}
