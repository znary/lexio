import { i18n } from "#imports"
import { useAtom } from "jotai"
import {
  FieldGroup,
} from "@/components/ui/base-ui/field"
import { Label } from "@/components/ui/base-ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/base-ui/radio-group"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { MANAGED_CLOUD_PROVIDER_ID } from "@/utils/constants/platform"
import { ConfigCard } from "../../components/config-card"

export default function PageLanguageDetectionConfig() {
  const [languageDetection, setLanguageDetection] = useAtom(configFieldsAtomMap.languageDetection)

  return (
    <ConfigCard
      id="page-language-detection"
      title={i18n.t("options.translation.pageLanguageDetection.title")}
      description={i18n.t("options.translation.pageLanguageDetection.description")}
    >
      <FieldGroup>
        <RadioGroup
          value={languageDetection.mode}
          onValueChange={(value: string) => {
            if (value !== "basic" && value !== "llm")
              return

            void setLanguageDetection(
              value === "llm"
                ? {
                    mode: "llm",
                    providerId: MANAGED_CLOUD_PROVIDER_ID,
                  }
                : { mode: "basic" },
            )
          }}
          className="flex flex-row gap-4"
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem value="basic" id="page-lang-detection-basic" />
            <Label htmlFor="page-lang-detection-basic">{i18n.t("options.translation.pageLanguageDetection.mode.basic")}</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="llm" id="page-lang-detection-llm" />
            <Label htmlFor="page-lang-detection-llm">{i18n.t("options.translation.pageLanguageDetection.mode.llm")}</Label>
          </div>
        </RadioGroup>
      </FieldGroup>
    </ConfigCard>
  )
}
