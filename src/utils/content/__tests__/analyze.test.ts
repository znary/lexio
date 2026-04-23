// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_CONFIG } from "@/utils/constants/config"

const mockDetectLanguageWithSource = vi.fn()

vi.mock("@/utils/content/language", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/content/language")>()
  return {
    ...actual,
    detectLanguageWithSource: mockDetectLanguageWithSource,
  }
})

async function loadModule() {
  vi.resetModules()
  return await import("../analyze")
}

describe("detectDocumentLanguageForBootstrap", () => {
  beforeEach(() => {
    mockDetectLanguageWithSource.mockReset()
    document.documentElement.removeAttribute("lang")
    document.documentElement.removeAttribute("xml:lang")
    document.body.removeAttribute("lang")
    document.body.innerHTML = ""
  })

  it("uses the document lang attribute before sampling text", async () => {
    document.documentElement.lang = "en-US"

    const { detectDocumentLanguageForBootstrap } = await loadModule()
    const result = await detectDocumentLanguageForBootstrap(DEFAULT_CONFIG)

    expect(result).toEqual({
      detectedCodeOrUnd: "eng",
      detectionSource: "document",
    })
    expect(mockDetectLanguageWithSource).not.toHaveBeenCalled()
  })

  it("samples page text and skips code-heavy nodes", async () => {
    mockDetectLanguageWithSource.mockResolvedValue({
      code: "spa",
      source: "franc",
    })
    document.body.innerHTML = `
      <script>window.__test = "ignore me"</script>
      <pre>const hidden = "skip this"</pre>
      <main>
        <h1>Hola mundo</h1>
        <p>Esto es una prueba real.</p>
        <code>console.log("skip this too")</code>
      </main>
    `

    const { detectDocumentLanguageForBootstrap } = await loadModule()
    const result = await detectDocumentLanguageForBootstrap(DEFAULT_CONFIG)

    expect(result).toEqual({
      detectedCodeOrUnd: "spa",
      detectionSource: "franc",
    })
    expect(mockDetectLanguageWithSource).toHaveBeenCalledTimes(1)

    const [sampleText, options] = mockDetectLanguageWithSource.mock.calls[0]
    expect(sampleText).toContain("Hola mundo")
    expect(sampleText).toContain("Esto es una prueba real.")
    expect(sampleText).not.toContain("ignore me")
    expect(sampleText).not.toContain("skip this")
    expect(options).toMatchObject({
      enableLLM: false,
      maxLengthForLLM: 1500,
    })
  })
})
