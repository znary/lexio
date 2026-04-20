import { i18n } from "#imports"
import { PlatformQuickAccess } from "@/components/platform/platform-quick-access"
import { AISmartContext } from "../../../popup/components/ai-smart-context"
import Hotkey from "../../../popup/components/node-translation-hotkey-selector"
import { ConfigCard } from "../../components/config-card"

export function GeneralQuickSettings() {
  return (
    <>
      <ConfigCard
        id="lexio-cloud"
        title={i18n.t("options.general.quickSettings.cloud.title")}
        description={i18n.t("options.general.quickSettings.cloud.description")}
      >
        <PlatformQuickAccess className="border-border bg-muted/20" />
      </ConfigCard>

      <ConfigCard
        id="shortcut-controls"
        title={i18n.t("options.general.quickSettings.shortcuts.title")}
        description={i18n.t("options.general.quickSettings.shortcuts.description")}
      >
        <div className="space-y-4">
          <Hotkey />
          <AISmartContext />
        </div>
      </ConfigCard>
    </>
  )
}
