import { ClerkProvider } from "@clerk/clerk-react"
import * as React from "react"
import ReactDOM from "react-dom/client"
import { Toaster } from "sonner"
import App from "./app/app"
import { APP_ROUTES } from "./app/routes"
import "./app/styles.css"

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

if (!publishableKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY")
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ClerkProvider publishableKey={publishableKey} afterSignOutUrl={APP_ROUTES.signIn}>
      <Toaster richColors position="top-right" />
      <App />
    </ClerkProvider>
  </React.StrictMode>,
)
