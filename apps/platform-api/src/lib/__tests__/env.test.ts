import { describe, expect, it } from "vitest"
import { isPlatformChatWebFetchEnabled } from "../env"

describe("platform env helpers", () => {
  it("enables platform chat webpage fetching by default", () => {
    expect(isPlatformChatWebFetchEnabled({})).toBe(true)
  })

  it("allows platform chat webpage fetching to be disabled explicitly", () => {
    expect(isPlatformChatWebFetchEnabled({
      PLATFORM_CHAT_WEB_FETCH_ENABLED: "false",
    })).toBe(false)
  })

  it("keeps platform chat webpage fetching enabled for truthy values", () => {
    expect(isPlatformChatWebFetchEnabled({
      PLATFORM_CHAT_WEB_FETCH_ENABLED: "true",
    })).toBe(true)
  })
})
