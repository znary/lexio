import { i18n } from "#imports"
import { useAtom } from "jotai"
import { useMemo } from "react"
import { Input } from "@/components/ui/base-ui/input"
import { Switch } from "@/components/ui/base-ui/switch"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { ConfigCard } from "../../components/config-card"

export function VocabularySettingsCard() {
  const [vocabulary, setVocabulary] = useAtom(configFieldsAtomMap.vocabulary)
  const colorValue = useMemo(() => vocabulary.highlightColor || "#fde68a", [vocabulary.highlightColor])

  return (
    <ConfigCard
      id="vocabulary-settings"
      title={i18n.t("options.vocabulary.title")}
      description={i18n.t("options.vocabulary.description")}
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">{i18n.t("options.vocabulary.autoSave.title")}</p>
            <p className="text-sm text-muted-foreground">{i18n.t("options.vocabulary.autoSave.description")}</p>
          </div>
          <Switch
            checked={vocabulary.autoSave}
            onCheckedChange={(checked) => {
              void setVocabulary({ ...vocabulary, autoSave: checked })
            }}
          />
        </div>

        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">{i18n.t("options.vocabulary.highlight.title")}</p>
            <p className="text-sm text-muted-foreground">{i18n.t("options.vocabulary.highlight.description")}</p>
          </div>
          <Switch
            checked={vocabulary.highlightEnabled}
            onCheckedChange={(checked) => {
              void setVocabulary({ ...vocabulary, highlightEnabled: checked })
            }}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_140px]">
          <label className="space-y-2">
            <span className="text-sm font-medium">{i18n.t("options.vocabulary.maxPhraseWords.title")}</span>
            <span className="block text-sm text-muted-foreground">{i18n.t("options.vocabulary.maxPhraseWords.description")}</span>
          </label>
          <Input
            type="number"
            min={1}
            max={20}
            value={String(vocabulary.maxPhraseWords)}
            onChange={(event) => {
              const nextValue = Number.parseInt(event.target.value || "0", 10)
              if (Number.isNaN(nextValue)) {
                return
              }

              void setVocabulary({
                ...vocabulary,
                maxPhraseWords: Math.max(1, Math.min(20, nextValue)),
              })
            }}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_140px]">
          <label className="space-y-2">
            <span className="text-sm font-medium">{i18n.t("options.vocabulary.highlightColor.title")}</span>
            <span className="block text-sm text-muted-foreground">{i18n.t("options.vocabulary.highlightColor.description")}</span>
          </label>
          <div className="flex items-center gap-3">
            <input
              type="color"
              aria-label={i18n.t("options.vocabulary.highlightColor.title")}
              value={colorValue}
              className="h-8 w-12 cursor-pointer rounded border bg-transparent p-0"
              onChange={(event) => {
                void setVocabulary({ ...vocabulary, highlightColor: event.target.value })
              }}
            />
            <Input
              value={colorValue}
              onChange={(event) => {
                void setVocabulary({ ...vocabulary, highlightColor: event.target.value })
              }}
            />
          </div>
        </div>
      </div>
    </ConfigCard>
  )
}
