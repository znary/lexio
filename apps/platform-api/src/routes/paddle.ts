import type { Env } from "../lib/env"
import { upsertSubscriptionFromPaddle } from "../lib/db"
import { HttpError, json } from "../lib/http"
import { resolvePlanFromPaddleItems, verifyPaddleSignature } from "../lib/paddle"

interface PaddleWebhookEvent {
  event_type: string
  data?: Record<string, unknown>
}

function getObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {}
}

export async function handlePaddleWebhook(request: Request, env: Env) {
  const rawBody = await request.text()
  await verifyPaddleSignature(rawBody, request.headers.get("Paddle-Signature"), env)

  const event = JSON.parse(rawBody) as PaddleWebhookEvent
  const data = getObject(event.data)
  const customData = getObject(data.custom_data)
  const items = Array.isArray(data.items) ? data.items.filter(item => item && typeof item === "object") as Array<Record<string, unknown>> : []
  const subscriptionId = typeof data.id === "string" ? data.id : null
  const clerkUserId = typeof customData.clerkUserId === "string" ? customData.clerkUserId : null

  if (!subscriptionId || !clerkUserId) {
    throw new HttpError(400, "Paddle webhook missing subscription id or custom_data.clerkUserId")
  }

  const status = typeof data.status === "string" ? data.status : "active"
  const currentPeriod = getObject(data.current_billing_period)
  const startedAt = typeof currentPeriod.starts_at === "string" ? currentPeriod.starts_at : null
  const endsAt = typeof currentPeriod.ends_at === "string" ? currentPeriod.ends_at : null
  const scheduledChange = getObject(data.scheduled_change)
  const cancelAtPeriodEnd = Boolean(scheduledChange.effective_at)
  const plan = resolvePlanFromPaddleItems(items, env)

  if ([
    "subscription.created",
    "subscription.updated",
    "subscription.activated",
    "subscription.canceled",
    "subscription.resumed",
    "subscription.past_due",
  ].includes(event.event_type)) {
    await upsertSubscriptionFromPaddle(
      env,
      clerkUserId,
      subscriptionId,
      plan,
      status,
      startedAt,
      endsAt,
      cancelAtPeriodEnd,
    )
  }

  return json({ ok: true, eventType: event.event_type, plan })
}
