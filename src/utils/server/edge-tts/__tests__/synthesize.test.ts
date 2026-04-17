import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { combineEdgeTTSAudioChunks, synthesizeEdgeTTSChunkWithRetry } from "../synthesize"

const { getEdgeTTSEndpointTokenMock, clearEdgeTTSTokenCacheMock } = vi.hoisted(() => ({
  getEdgeTTSEndpointTokenMock: vi.fn(),
  clearEdgeTTSTokenCacheMock: vi.fn(),
}))

vi.mock("../endpoint", () => ({
  getEdgeTTSEndpointToken: (...args: unknown[]) => getEdgeTTSEndpointTokenMock(...args),
  clearEdgeTTSTokenCache: (...args: unknown[]) => clearEdgeTTSTokenCacheMock(...args),
}))

describe("combineEdgeTTSAudioChunks", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getEdgeTTSEndpointTokenMock.mockResolvedValue({
      endpoint: {
        r: "eastus",
        t: "Bearer test-token",
      },
      token: "test-token",
      expiredAt: Date.now() + 60_000,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("rejects non-concatenable output formats for multi-chunk synthesis", async () => {
    await expect(combineEdgeTTSAudioChunks([
      {
        text: "first",
        voice: "en-US-JennyNeural",
        outputFormat: "riff-24khz-16bit-mono-pcm",
      },
      {
        text: "second",
        voice: "en-US-JennyNeural",
        outputFormat: "riff-24khz-16bit-mono-pcm",
      },
    ])).rejects.toThrowError(/not safe for multi-chunk concatenation/i)
  })

  it("rejects mixed output formats for multi-chunk synthesis", async () => {
    await expect(combineEdgeTTSAudioChunks([
      {
        text: "first",
        voice: "en-US-JennyNeural",
        outputFormat: "audio-24khz-48kbitrate-mono-mp3",
      },
      {
        text: "second",
        voice: "en-US-JennyNeural",
        outputFormat: "raw-24khz-16bit-mono-pcm",
      },
    ])).rejects.toThrowError(/mixed output formats are not supported/i)
  })

  it("retries when the service returns an empty audio body", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(0),
        headers: new Headers({
          "content-type": "audio/mpeg",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        headers: new Headers({
          "content-type": "audio/mpeg",
        }),
      })

    vi.stubGlobal("fetch", fetchMock)

    const response = await synthesizeEdgeTTSChunkWithRetry({
      text: "hello",
      voice: "en-US-DavisNeural",
    })

    expect(response.audio.byteLength).toBe(3)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
