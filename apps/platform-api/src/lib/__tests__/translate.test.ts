import { describe, expect, it } from "vitest"
import { extractDeltaText, extractTranslatedText } from "../../routes/translate"
import { HttpError } from "../http"

describe("managed translate helpers", () => {
  it("extracts translated text and token usage from chat completion payloads", () => {
    const payload = JSON.stringify({
      choices: [
        {
          message: {
            content: [
              { type: "text", text: " 你好 " },
            ],
          },
        },
      ],
      usage: {
        prompt_tokens: 12,
        completion_tokens: 8,
      },
    })

    expect(extractTranslatedText(payload)).toEqual({
      text: "你好",
      inputTokens: 12,
      outputTokens: 8,
    })
  })

  it("throws when the managed translation response is empty", () => {
    expect(() => extractTranslatedText(JSON.stringify({
      choices: [
        {
          message: {
            content: "",
          },
        },
      ],
    }))).toThrowError(HttpError)
  })

  it("extracts text from streamed translation chunks", () => {
    expect(extractDeltaText(JSON.stringify({
      choices: [
        {
          delta: {
            content: "你",
          },
        },
      ],
    }))).toBe("你")

    expect(extractDeltaText(JSON.stringify({
      choices: [
        {
          delta: {
            content: [
              { type: "text", text: "好" },
            ],
          },
        },
      ],
    }))).toBe("好")
  })
})
