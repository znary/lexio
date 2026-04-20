import { i18n } from "#imports"
import LanguageOptionsSelector from "../../../popup/components/language-options-selector"
import TranslatePromptSelector from "../../../popup/components/translate-prompt-selector"
import TranslationModeSelector from "../../../popup/components/translation-mode-selector"
import { ConfigCard } from "../../components/config-card"

export function TranslationQuickControls() {
  return (
    <ConfigCard
      id="translation-quick-controls"
      title={i18n.t("options.general.quickSettings.reading.title")}
      description={i18n.t("options.general.quickSettings.reading.description")}
    >
      <div className="space-y-4">
        <LanguageOptionsSelector />
        <TranslationModeSelector />
        <TranslatePromptSelector />
      </div>
    </ConfigCard>
  )
}
