import { IconLogin2, IconSettings, IconSparkles, IconStars } from "@tabler/icons-react"
import { Button } from "@/components/ui/base-ui/button"
import { sendMessage } from "@/utils/message"
import { openPlatformExtensionSyncTab, openPlatformPricingTab } from "@/utils/platform/navigation"

const featureCards = [
  {
    title: "Cloud chat history",
    description: "Save page explanations and keep the same thread history on every device.",
    icon: IconSparkles,
  },
  {
    title: "Full settings",
    description: "Adjust translation rules, prompts, shortcuts, and the floating button in one place.",
    icon: IconSettings,
  },
] as const

export function SidepanelWelcomeState() {
  return (
    <div className="mx-auto flex h-full w-full max-w-md items-center justify-center py-4">
      <section className="w-full rounded-[28px] border border-border/70 bg-card px-5 py-6 shadow-[0_20px_48px_-28px_rgba(15,23,42,0.35)]">
        <div className="inline-flex size-12 items-center justify-center rounded-2xl bg-primary/12 text-primary">
          <IconStars className="size-5" />
        </div>

        <div className="mt-4 space-y-2">
          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Lexio Cloud
          </p>
          <h2 className="text-xl font-semibold tracking-tight text-foreground">
            The sidebar is ready.
          </h2>
          <p className="text-sm leading-6 text-muted-foreground">
            Sign in to start cloud chat, explain the current page, and keep your setup in sync.
          </p>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {featureCards.map(({ title, description, icon: Icon }) => (
            <div
              key={title}
              className="rounded-2xl border border-border/70 bg-muted/35 p-3.5"
            >
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <span className="inline-flex size-8 items-center justify-center rounded-xl bg-background text-muted-foreground shadow-sm">
                  <Icon className="size-4" />
                </span>
                {title}
              </div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                {description}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-5 flex flex-col gap-2">
          <Button
            type="button"
            size="lg"
            className="w-full justify-center"
            onClick={() => {
              void openPlatformExtensionSyncTab()
            }}
          >
            <IconLogin2 className="size-4" />
            Sign in
          </Button>

          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              size="lg"
              variant="outline"
              className="justify-center"
              onClick={() => {
                void sendMessage("openOptionsPage", undefined)
              }}
            >
              <IconSettings className="size-4" />
              Open settings
            </Button>

            <Button
              type="button"
              size="lg"
              variant="outline"
              className="justify-center"
              onClick={() => {
                void openPlatformPricingTab()
              }}
            >
              <IconSparkles className="size-4" />
              View plans
            </Button>
          </div>
        </div>
      </section>
    </div>
  )
}
