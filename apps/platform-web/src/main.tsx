import { ClerkProvider } from "@clerk/clerk-react"
import * as React from "react"
import ReactDOM from "react-dom/client"
import { Toaster } from "sonner"
import App from "./app/app"
import { CLERK_PUBLISHABLE_KEY } from "./app/env"
import { APP_ROUTES } from "./app/routes"
import { SitePreferencesProvider } from "./app/site-preferences"
import "./app/styles.css"

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SitePreferencesProvider>
      <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} afterSignOutUrl={APP_ROUTES.signIn}>
        <Toaster richColors position="top-right" />
        <App />
      </ClerkProvider>
    </SitePreferencesProvider>
  </React.StrictMode>,
)
