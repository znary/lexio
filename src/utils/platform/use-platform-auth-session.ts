import type { PlatformAuthSession } from "./storage"
import { useEffect, useState } from "react"
import { getPlatformAuthSession, watchPlatformAuthSession } from "./storage"

export function usePlatformAuthSession() {
  const [session, setSession] = useState<PlatformAuthSession | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let isDisposed = false

    async function loadSession() {
      const nextSession = await getPlatformAuthSession()
      if (isDisposed) {
        return
      }

      setSession(nextSession)
      setIsLoading(false)
    }

    void loadSession()

    const unwatch = watchPlatformAuthSession((nextSession) => {
      if (isDisposed) {
        return
      }

      setSession(nextSession)
      setIsLoading(false)
    })

    return () => {
      isDisposed = true
      unwatch?.()
    }
  }, [])

  return {
    session,
    isLoading,
    isSignedIn: Boolean(session),
  }
}
