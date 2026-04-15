import { useAuth } from "@clerk/clerk-react"
import { useEffect, useRef } from "react"
import { clearPlatformAuthSessionInExtension } from "./platform-auth"

export function PlatformAuthBridge() {
  const { isLoaded, isSignedIn } = useAuth()
  const wasSignedInRef = useRef(false)

  useEffect(() => {
    if (!isLoaded) {
      return
    }

    if (wasSignedInRef.current && !isSignedIn) {
      void clearPlatformAuthSessionInExtension()
    }

    wasSignedInRef.current = isSignedIn
  }, [isLoaded, isSignedIn])

  return null
}
