import { describe, expect, it } from "vitest"
import { supportsStructuredOutputsForCustomProvider } from "../model"

describe("supportsStructuredOutputsForCustomProvider", () => {
  it("disables structured outputs for volcengine", () => {
    expect(supportsStructuredOutputsForCustomProvider("volcengine")).toBe(false)
  })

  it("keeps structured outputs enabled for generic OpenAI-compatible providers", () => {
    expect(supportsStructuredOutputsForCustomProvider("openai-compatible")).toBe(true)
  })
})
