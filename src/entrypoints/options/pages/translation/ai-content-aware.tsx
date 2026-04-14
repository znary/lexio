import { i18n } from "#imports"
import { deepmerge } from "deepmerge-ts"
import { useAtom } from "jotai"
import { HelpTooltip } from "@/components/help-tooltip"
import { Field, FieldContent, FieldLabel } from "@/components/ui/base-ui/field"
import { Switch } from "@/components/ui/base-ui/switch"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { ConfigCard } from "../../components/config-card"

export function AIContentAware() {
  const [translateConfig, setTranslateConfig] = useAtom(configFieldsAtomMap.translate)

  return (
    <ConfigCard
      id="ai-content-aware"
      title={i18n.t("options.translation.aiContentAware.title")}
      description={i18n.t("options.translation.aiContentAware.description")}
    >
      <Field orientation="horizontal">
        <FieldContent className="self-center">
          <FieldLabel htmlFor="ai-content-aware-toggle">
            {i18n.t("options.translation.aiContentAware.enable")}
            <HelpTooltip>{i18n.t("options.translation.aiContentAware.enableDescription")}</HelpTooltip>
          </FieldLabel>
        </FieldContent>
        <Switch
          id="ai-content-aware-toggle"
          checked={translateConfig.enableAIContentAware}
          onCheckedChange={(checked) => {
            void setTranslateConfig(
              deepmerge(translateConfig, {
                enableAIContentAware: checked,
              }),
            )
          }}
        />
      </Field>
    </ConfigCard>
  )
}
