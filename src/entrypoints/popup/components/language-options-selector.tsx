import type { LangCodeISO6393 } from "@read-frog/definitions"
import { i18n } from "#imports"
import { Icon } from "@iconify/react"
import {
  LANG_CODE_TO_LOCALE_NAME,
  langCodeISO6393Schema,
} from "@read-frog/definitions"
import { useAtom, useAtomValue } from "jotai"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/base-ui/select"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { detectedCodeAtom } from "@/utils/atoms/detected-code"

const LOCALE_BRACKET_CONTENT_PATTERN = /\(([^()]+)\)/g

function langCodeLabel(langCode: LangCodeISO6393) {
  const localeName = LANG_CODE_TO_LOCALE_NAME[langCode]
  const bracketContents = Array.from(
    localeName.matchAll(LOCALE_BRACKET_CONTENT_PATTERN),
    match => match[1]?.trim(),
  )
    .filter(Boolean)

  if (bracketContents.length > 0) {
    return bracketContents.join(" ")
  }

  return localeName
}

const langSelectorTriggerClasses = "!h-14 w-full min-w-0 rounded-lg shadow-xs pr-2 gap-1"

const langSelectorContentClasses = "flex flex-col items-start text-base font-medium min-w-0 flex-1"

export default function LanguageOptionsSelector() {
  const [language, setLanguage] = useAtom(configFieldsAtomMap.language)
  const detectedCode = useAtomValue(detectedCodeAtom)

  const handleSourceLangChange = (newLangCode: LangCodeISO6393 | "auto" | null) => {
    if (!newLangCode)
      return
    void setLanguage({ sourceCode: newLangCode })
  }

  const handleTargetLangChange = (newLangCode: LangCodeISO6393 | null) => {
    if (!newLangCode)
      return
    void setLanguage({ targetCode: newLangCode })
  }

  const sourceLangLabel = langCodeLabel(detectedCode)
  const targetLangLabel = langCodeLabel(language.targetCode)

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
      <div className="min-w-0">
        <Select value={language.sourceCode} onValueChange={handleSourceLangChange}>
          <SelectTrigger className={langSelectorTriggerClasses}>
            <div className={langSelectorContentClasses}>
              <SelectValue render={<span className="flex w-full min-w-0 items-center gap-2" />}>
                <span className="truncate">{language.sourceCode === "auto" ? sourceLangLabel : langCodeLabel(language.sourceCode)}</span>
                {language.sourceCode === "auto" && <AutoLangCell />}
              </SelectValue>
              <span className="text-sm text-neutral-500">
                {language.sourceCode === "auto"
                  ? i18n.t("popup.autoLang")
                  : i18n.t("popup.sourceLang")}
              </span>
            </div>
          </SelectTrigger>
          <SelectContent className="rounded-lg shadow-md w-72">
            <SelectGroup>
              <SelectItem value="auto">
                <span className="truncate">{langCodeLabel(detectedCode)}</span>
                <AutoLangCell />
              </SelectItem>
              {langCodeISO6393Schema.options.map(key => (
                <SelectItem key={key} value={key}>
                  <span className="truncate">{langCodeLabel(key)}</span>
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <Icon icon="tabler:arrow-right" className="h-4 w-4 shrink-0 text-neutral-500" />
      <div className="min-w-0">
        <Select value={language.targetCode} onValueChange={handleTargetLangChange}>
          <SelectTrigger className={langSelectorTriggerClasses}>
            <div className={langSelectorContentClasses}>
              <SelectValue render={<span className="truncate w-full" />}>
                {targetLangLabel}
              </SelectValue>
              <span className="text-sm text-neutral-500">{i18n.t("popup.targetLang")}</span>
            </div>
          </SelectTrigger>
          <SelectContent className="rounded-lg shadow-md w-72">
            <SelectGroup>
              {langCodeISO6393Schema.options.map(key => (
                <SelectItem key={key} value={key}>
                  <span className="truncate">{langCodeLabel(key)}</span>
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

function AutoLangCell() {
  return <span className="rounded-full bg-neutral-200 px-1 text-xs dark:bg-neutral-800 flex items-center">auto</span>
}
