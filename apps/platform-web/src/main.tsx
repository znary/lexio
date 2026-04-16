import { ClerkProvider } from "@clerk/clerk-react"
import * as React from "react"
import ReactDOM from "react-dom/client"
import { Toaster } from "sonner"
import App from "./app/app"
import { CLERK_PUBLISHABLE_KEY } from "./app/env"
import { APP_ROUTES } from "./app/routes"
import "./app/styles.css"

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} afterSignOutUrl={APP_ROUTES.signIn}>
      <Toaster richColors position="top-right" />
      <App />
    </ClerkProvider>
  </React.StrictMode>,
)
