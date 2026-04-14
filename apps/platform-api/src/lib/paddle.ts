import type { Env, Plan } from "./env"
import { HttpError } from "./http"

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

export async function verifyPaddleSignature(rawBody: string, signatureHeader: string | null, env: Env): Promise<void> {
  const secret = env.PADDLE_WEBHOOK_SECRET
  if (!secret) {
    throw new HttpError(500, "Paddle webhook secret is not configured")
  }

  if (!signatureHeader) {
    throw new HttpError(401, "Missing Paddle-Signature header")
  }

  const parts = signatureHeader
    .split(";")
    .map(part => part.trim())
    .filter(Boolean)

  const timestamp = parts.find(part => part.startsWith("ts="))?.slice(3)
  const signatures = parts
    .filter(part => part.startsWith("h1="))
    .map(part => part.slice(3))
    .filter(Boolean)

  if (!timestamp || signatures.length === 0) {
    throw new HttpError(401, "Invalid Paddle signature format")
  }

  const driftMs = Math.abs(Date.now() - Number(timestamp) * 1000)
  if (!Number.isFinite(driftMs) || driftMs > 30_000) {
    throw new HttpError(401, "Paddle signature timestamp expired")
  }

  const payload = `${timestamp}:${rawBody}`
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const signatureBuffer = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(payload))
  const expectedSignature = Array.from(new Uint8Array(signatureBuffer), byte => byte.toString(16).padStart(2, "0"))
    .join("")

  const valid = signatures.some(signature => safeEqual(signature, expectedSignature))
  if (!valid) {
    throw new HttpError(401, "Invalid Paddle signature")
  }
}

export function resolvePlanFromPaddleItems(items: Array<Record<string, unknown>> | undefined, env: Env): Plan {
  const proPriceId = env.PADDLE_PRO_PRICE_ID
  if (!proPriceId) {
    return "free"
  }

  const hasProPrice = (items ?? []).some((item) => {
    const priceId = typeof item.price_id === "string"
      ? item.price_id
      : (item.price && typeof item.price === "object" && item.price && "id" in item.price ? String(item.price.id) : "")
    return priceId === proPriceId
  })

  return hasProPrice ? "pro" : "free"
}
