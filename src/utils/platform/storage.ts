import { storage } from "#imports"
import { z } from "zod"
import { PLATFORM_AUTH_STORAGE_KEY } from "../constants/config"
import { logger } from "../logger"

const platformUserSchema = z.object({
  id: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
})

export const platformAuthSessionSchema = z.object({
  token: z.string().min(1),
  user: platformUserSchema.optional(),
  updatedAt: z.number().int().nonnegative(),
})

export type PlatformAuthSession = z.infer<typeof platformAuthSessionSchema>

export async function getPlatformAuthSession(): Promise<PlatformAuthSession | null> {
  const value = await storage.getItem<unknown>(`local:${PLATFORM_AUTH_STORAGE_KEY}`)
  const parsed = platformAuthSessionSchema.safeParse(value)

  if (parsed.success) {
    return parsed.data
  }

  if (value != null) {
    logger.warn("Platform auth session is invalid, clearing it")
    await storage.removeItem(`local:${PLATFORM_AUTH_STORAGE_KEY}`)
  }

  return null
}

export async function setPlatformAuthSession(
  payload: Omit<PlatformAuthSession, "updatedAt"> & { updatedAt?: number },
): Promise<PlatformAuthSession> {
  const nextSession: PlatformAuthSession = {
    ...payload,
    updatedAt: payload.updatedAt ?? Date.now(),
  }

  await storage.setItem(`local:${PLATFORM_AUTH_STORAGE_KEY}`, nextSession)
  return nextSession
}

export async function clearPlatformAuthSession(): Promise<void> {
  await storage.removeItem(`local:${PLATFORM_AUTH_STORAGE_KEY}`)
}

export function watchPlatformAuthSession(callback: (session: PlatformAuthSession | null) => void) {
  return storage.watch<unknown>(`local:${PLATFORM_AUTH_STORAGE_KEY}`, (value) => {
    const parsed = platformAuthSessionSchema.safeParse(value)
    callback(parsed.success ? parsed.data : null)
  })
}
