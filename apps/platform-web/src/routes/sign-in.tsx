import { SignIn } from "@clerk/clerk-react"
import { getExtensionIdFromLocation } from "../app/env"
import { APP_ROUTES } from "../app/routes"
import { useSitePreferences } from "../app/site-preferences"

function getSignInAppearance(resolvedTheme: "light" | "dark"): Parameters<typeof SignIn>[0]["appearance"] {
  const isDark = resolvedTheme === "dark"

  return {
    theme: "simple",
    layout: {
      logoPlacement: "none",
      socialButtonsPlacement: "bottom",
    },
    variables: {
      colorPrimary: "#0f6c68",
      colorPrimaryForeground: "#ffffff",
      colorSuccess: "#2f8f52",
      colorDanger: "#b53d2f",
      colorWarning: "#c27a17",
      colorNeutral: isDark ? "rgba(224, 233, 236, 0.9)" : "rgba(25, 28, 30, 0.88)",
      colorForeground: isDark ? "#edf4f5" : "#191c1e",
      colorMuted: isDark ? "#142026" : "#f2f4f6",
      colorMutedForeground: isDark ? "#9fb1b8" : "#506169",
      colorBackground: isDark ? "#0f171b" : "#ffffff",
      colorInput: isDark ? "#0b1216" : "#ffffff",
      colorInputForeground: isDark ? "#edf4f5" : "#191c1e",
      colorBorder: isDark ? "rgba(121, 140, 147, 0.3)" : "rgba(190, 201, 199, 0.42)",
      colorRing: "rgba(15, 108, 104, 0.34)",
      colorShadow: isDark ? "#000000" : "rgba(0, 67, 65, 0.12)",
      fontFamily: "Inter, system-ui, sans-serif",
      fontFamilyButtons: "Manrope, system-ui, sans-serif",
      borderRadius: "16px",
    },
    elements: {
      card: {
        boxShadow: "0 24px 42px rgba(0, 67, 65, 0.1)",
        border: isDark ? "1px solid rgba(121, 140, 147, 0.22)" : "1px solid rgba(190, 201, 199, 0.32)",
      },
      footerActionLink: {
        color: "#0f6c68",
      },
      formButtonPrimary: {
        minHeight: "48px",
        fontFamily: "Manrope, system-ui, sans-serif",
        fontWeight: "700",
      },
      socialButtonsBlockButton: {
        minHeight: "46px",
      },
    },
    captcha: {
      theme: isDark ? "dark" : "light",
    },
  }
}

export function SignInPage() {
  const extensionId = getExtensionIdFromLocation()
  const { resolvedTheme } = useSitePreferences()
  const fallbackRedirectUrl = extensionId
    ? `${APP_ROUTES.extensionSync}?extensionId=${encodeURIComponent(extensionId)}`
    : APP_ROUTES.wordBank

  return (
    <section className="signin-page">
      <div className="signin-panel signin-panel--centered">
        <SignIn
          routing="path"
          path={APP_ROUTES.signIn}
          signUpUrl={APP_ROUTES.signIn}
          fallbackRedirectUrl={fallbackRedirectUrl}
          appearance={getSignInAppearance(resolvedTheme)}
        />
      </div>
    </section>
  )
}
