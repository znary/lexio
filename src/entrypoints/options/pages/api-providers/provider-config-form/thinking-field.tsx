import type { APIProviderConfig } from "@/types/config/provider"
import { i18n } from "#imports"
import { useStore } from "@tanstack/react-form"
import { useId } from "react"
import { HelpTooltip } from "@/components/help-tooltip"
import { Field, FieldContent, FieldLabel } from "@/components/ui/base-ui/field"
import { Switch } from "@/components/ui/base-ui/switch"
import { isLLMProviderConfig } from "@/types/config/provider"
import { withForm } from "./form"

const translate = (key: string) => i18n.t(key as never)

export const ThinkingField = withForm({
  ...{ defaultValues: {} as APIProviderConfig },
  render: function Render({ form }) {
    const providerConfig = useStore(form.store, state => state.values)
    const isLLMProvider = isLLMProviderConfig(providerConfig)
    const switchId = useId()

    if (!isLLMProvider) {
      return null
    }

    const checked = providerConfig.disableThinking ?? true

    return (
      <Field orientation="horizontal">
        <FieldContent className="self-center">
          <FieldLabel htmlFor={switchId}>
            {translate("options.apiProviders.form.disableThinking")}
            <HelpTooltip>{translate("options.apiProviders.form.disableThinkingHint")}</HelpTooltip>
          </FieldLabel>
          <p className="text-sm text-muted-foreground">
            {translate("options.apiProviders.form.disableThinkingDescription")}
          </p>
        </FieldContent>
        <Switch
          id={switchId}
          checked={checked}
          onCheckedChange={(nextChecked) => {
            form.setFieldValue("disableThinking", nextChecked)
            void form.handleSubmit()
          }}
        />
      </Field>
    )
  },
})
