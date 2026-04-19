import { usePlatformAuthSession } from "@/utils/platform/use-platform-auth-session"
import { ChatWorkspace } from "./components/chat-workspace"

export default function App() {
  const { session, isLoading, isSignedIn } = usePlatformAuthSession()
  const sessionAccountKey = session?.user?.id ?? session?.user?.email ?? (session ? "signed-in" : null)

  return (
    <div className="flex h-screen flex-col bg-background">
      <div className="flex min-h-0 flex-1 flex-col">
        <ChatWorkspace
          isSignedIn={isSignedIn}
          isSessionLoading={isLoading}
          sessionAccountKey={sessionAccountKey}
        />
      </div>
    </div>
  )
}
