// @vitest-environment jsdom
import type { ReactNode } from "react"
import type { APIProviderConfig } from "@/types/config/provider"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { useEffect, useState } from "react"
import { describe, expect, it, vi } from "vitest"
import { formOpts, useAppForm } from "../form"
import { ThinkingField } from "../thinking-field"

vi.mock("#imports", () => ({
  i18n: {
    t: (key: string) => key,
  },
}))

vi.mock("@/components/help-tooltip", () => ({
  HelpTooltip: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}))

vi.mock("@/components/ui/base-ui/switch", () => ({
  Switch: ({
    checked,
    onCheckedChange,
  }: {
    checked?: boolean
    onCheckedChange?: (checked: boolean) => void
  }) => (
    <input
      aria-label="disable-thinking-switch"
      type="checkbox"
      checked={checked}
      onChange={event => onCheckedChange?.(event.target.checked)}
    />
  ),
}))

const baseProviderConfig: APIProviderConfig = {
  id: "provider-1",
  name: "OpenAI",
  enabled: true,
  provider: "openai",
  model: {
    model: "gpt-5-mini",
    isCustomModel: false,
    customModel: null,
  },
  providerOptions: undefined,
}

function ThinkingFieldHarness({ initialConfig }: { initialConfig: APIProviderConfig }) {
  const [providerConfig, setProviderConfig] = useState(initialConfig)
  const form = useAppForm({
    ...formOpts,
    defaultValues: providerConfig,
    onSubmit: async ({ value }) => {
      setProviderConfig(value)
    },
  })

  useEffect(() => {
    form.reset(providerConfig)
  }, [providerConfig, form])

  return (
    <>
      <ThinkingField form={form} />
      <output aria-label="disable-thinking-value">{String(providerConfig.disableThinking ?? true)}</output>
    </>
  )
}

describe("thinkingField", () => {
  it("defaults to enabled when the config does not store a value", () => {
    render(<ThinkingFieldHarness initialConfig={baseProviderConfig} />)

    expect(screen.getByLabelText("disable-thinking-switch")).toBeChecked()
    expect(screen.getByLabelText("disable-thinking-value")).toHaveTextContent("true")
  })

  it("stores false after the user turns the switch off", async () => {
    render(<ThinkingFieldHarness initialConfig={baseProviderConfig} />)

    await act(async () => {
      fireEvent.click(screen.getByLabelText("disable-thinking-switch"))
      await Promise.resolve()
    })

    expect(screen.getByLabelText("disable-thinking-switch")).not.toBeChecked()
    expect(screen.getByLabelText("disable-thinking-value")).toHaveTextContent("false")
  })
})
