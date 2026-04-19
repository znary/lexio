import { usePlatformAuthSession } from "@/utils/platform/use-platform-auth-session"
import { ChatWorkspace } from "./components/chat-workspace"

export default function App() {
  const { isLoading, isSignedIn } = usePlatformAuthSession()

  return (
    <div className="flex h-screen flex-col bg-background">
      <div className="flex min-h-0 flex-1 flex-col">
        <ChatWorkspace isSignedIn={isSignedIn} isSessionLoading={isLoading} />
      </div>
    </div>
  )
}
