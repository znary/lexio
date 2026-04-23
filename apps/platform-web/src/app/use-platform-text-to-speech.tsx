import type { LangCodeISO6393 } from "@read-frog/definitions"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { EDGE_TTS_FALLBACK_VOICE, getDefaultTTSVoiceForLanguage } from "@/types/config/tts"
import { synthesizeEdgeTTS } from "@/utils/server/edge-tts/api"
import { getTTSFriendlyErrorDescription, toSignedValue } from "@/utils/tts/shared"

type PlaybackState = "idle" | "fetching" | "playing"

const MAX_CACHED_AUDIO = 8

interface SpeechParams {
  text: string
  language?: string
}

interface PlayPlatformSpeechParams extends SpeechParams {
  playbackKey: string
  suppressErrors?: boolean
}

interface CachedAudioEntry {
  audioUrl: string
  cacheKey: string
}

interface PreparedSpeechSource {
  cacheKey: string
  text: string
  voice: string
}

function resolveVoice(language?: string): string {
  const normalizedLanguage = language?.trim()
  if (!normalizedLanguage || normalizedLanguage === "auto") {
    return EDGE_TTS_FALLBACK_VOICE
  }

  return getDefaultTTSVoiceForLanguage(normalizedLanguage as LangCodeISO6393, EDGE_TTS_FALLBACK_VOICE)
}

function getSpeechSource(params: SpeechParams): PreparedSpeechSource | null {
  const text = params.text.trim()
  if (!text) {
    return null
  }

  const voice = resolveVoice(params.language)
  return {
    cacheKey: `${voice}::${text}`,
    text,
    voice,
  }
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

export function usePlatformTextToSpeech(copy: {
  speechFailed: string
  speechLoading: string
  stopSpeaking: string
}) {
  const [state, setState] = useState<PlaybackState>("idle")
  const [activePlaybackKey, setActivePlaybackKey] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const activeCacheKeyRef = useRef<string | null>(null)
  const cacheRef = useRef<Map<string, CachedAudioEntry>>(new Map())
  const inflightRef = useRef<Map<string, Promise<CachedAudioEntry>>>(new Map())
  const requestIdRef = useRef(0)

  const clearPlaybackAudio = useCallback(() => {
    const currentAudio = audioRef.current
    if (currentAudio) {
      currentAudio.onended = null
      currentAudio.onerror = null
      currentAudio.pause()
      currentAudio.src = ""
      audioRef.current = null
    }

    activeCacheKeyRef.current = null
  }, [])

  const removeCachedAudio = useCallback((cacheKey: string) => {
    const cachedEntry = cacheRef.current.get(cacheKey)
    if (!cachedEntry) {
      return
    }

    URL.revokeObjectURL(cachedEntry.audioUrl)
    cacheRef.current.delete(cacheKey)
  }, [])

  const rememberCachedAudio = useCallback((entry: CachedAudioEntry) => {
    if (cacheRef.current.has(entry.cacheKey)) {
      cacheRef.current.delete(entry.cacheKey)
    }

    cacheRef.current.set(entry.cacheKey, entry)

    while (cacheRef.current.size > MAX_CACHED_AUDIO) {
      const oldestEntry = cacheRef.current.entries().next().value as [string, CachedAudioEntry] | undefined
      if (!oldestEntry) {
        break
      }

      const [oldestKey] = oldestEntry
      if (oldestKey === activeCacheKeyRef.current) {
        const activeEntry = cacheRef.current.get(oldestKey)
        if (!activeEntry) {
          break
        }

        cacheRef.current.delete(oldestKey)
        cacheRef.current.set(oldestKey, activeEntry)
        continue
      }

      removeCachedAudio(oldestKey)
    }
  }, [removeCachedAudio])

  const fetchSpeechAudio = useCallback(async (source: PreparedSpeechSource): Promise<CachedAudioEntry> => {
    const response = await synthesizeEdgeTTS({
      text: source.text,
      voice: source.voice,
      rate: toSignedValue(0, "%"),
      pitch: toSignedValue(0, "Hz"),
      volume: toSignedValue(0, "%"),
    })

    if (!response.ok) {
      throw new Error(`[${response.error.code}] ${response.error.message}`)
    }

    const audioUrl = URL.createObjectURL(new Blob([response.audio], {
      type: response.contentType,
    }))

    const cachedEntry = {
      audioUrl,
      cacheKey: source.cacheKey,
    }
    rememberCachedAudio(cachedEntry)
    return cachedEntry
  }, [rememberCachedAudio])

  const prepareSpeechAudio = useCallback(async (source: PreparedSpeechSource): Promise<CachedAudioEntry> => {
    const cachedEntry = cacheRef.current.get(source.cacheKey)
    if (cachedEntry) {
      rememberCachedAudio(cachedEntry)
      return cachedEntry
    }

    const inflightRequest = inflightRef.current.get(source.cacheKey)
    if (inflightRequest) {
      return await inflightRequest
    }

    const nextRequest = fetchSpeechAudio(source).finally(() => {
      inflightRef.current.delete(source.cacheKey)
    })
    inflightRef.current.set(source.cacheKey, nextRequest)
    return await nextRequest
  }, [fetchSpeechAudio, rememberCachedAudio])

  const stop = useCallback(() => {
    requestIdRef.current += 1
    clearPlaybackAudio()
    setState("idle")
    setActivePlaybackKey(null)
  }, [clearPlaybackAudio])

  useEffect(() => {
    return () => {
      clearPlaybackAudio()
      for (const [cacheKey] of cacheRef.current) {
        removeCachedAudio(cacheKey)
      }
      inflightRef.current.clear()
    }
  }, [clearPlaybackAudio, removeCachedAudio])

  const preload = useCallback(async (params: SpeechParams | SpeechParams[]) => {
    const requests = Array.isArray(params) ? params : [params]

    await Promise.all(requests.map(async (request) => {
      const source = getSpeechSource(request)
      if (!source) {
        return
      }

      try {
        await prepareSpeechAudio(source)
      }
      catch {
        // Preloading is opportunistic. Playback will retry if needed.
      }
    }))
  }, [prepareSpeechAudio])

  const play = useCallback(async ({
    playbackKey,
    text,
    language,
    suppressErrors = false,
  }: PlayPlatformSpeechParams) => {
    const source = getSpeechSource({ text, language })
    if (!source) {
      return false
    }

    if (activePlaybackKey === playbackKey && state !== "idle") {
      stop()
      return false
    }

    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    clearPlaybackAudio()
    setActivePlaybackKey(playbackKey)
    setState("fetching")

    try {
      const cachedEntry = await prepareSpeechAudio(source)
      if (requestIdRef.current !== requestId) {
        return false
      }

      const audio = new Audio(cachedEntry.audioUrl)
      audio.preload = "auto"
      audioRef.current = audio
      activeCacheKeyRef.current = cachedEntry.cacheKey
      audio.onended = () => {
        if (requestIdRef.current !== requestId) {
          return
        }

        clearPlaybackAudio()
        setState("idle")
        setActivePlaybackKey(null)
      }
      audio.onerror = () => {
        if (requestIdRef.current !== requestId) {
          return
        }

        clearPlaybackAudio()
        removeCachedAudio(cachedEntry.cacheKey)
        setState("idle")
        setActivePlaybackKey(null)
        if (!suppressErrors) {
          toast.error(copy.speechFailed)
        }
      }

      setState("playing")
      await audio.play()
      return true
    }
    catch (error) {
      if (requestIdRef.current !== requestId) {
        return false
      }

      clearPlaybackAudio()
      setState("idle")
      setActivePlaybackKey(null)
      if (!suppressErrors) {
        toast.error(copy.speechFailed, {
          description: getTTSFriendlyErrorDescription(normalizeError(error)),
        })
      }
      return false
    }
  }, [activePlaybackKey, clearPlaybackAudio, copy.speechFailed, prepareSpeechAudio, removeCachedAudio, state, stop])

  const getAriaLabel = useCallback((idleLabel: string, playbackKey: string) => {
    if (activePlaybackKey !== playbackKey) {
      return idleLabel
    }

    if (state === "fetching") {
      return copy.speechLoading
    }

    if (state === "playing") {
      return copy.stopSpeaking
    }

    return idleLabel
  }, [activePlaybackKey, copy.speechLoading, copy.stopSpeaking, state])

  return {
    play,
    preload,
    stop,
    state,
    activePlaybackKey,
    getAriaLabel,
  }
}
