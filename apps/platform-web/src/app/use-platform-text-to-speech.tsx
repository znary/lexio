import type { LangCodeISO6393 } from "@read-frog/definitions"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { EDGE_TTS_FALLBACK_VOICE, getDefaultTTSVoiceForLanguage } from "@/types/config/tts"
import { synthesizeEdgeTTS } from "@/utils/server/edge-tts/api"
import { getTTSFriendlyErrorDescription, toSignedValue } from "@/utils/tts/shared"

type PlaybackState = "idle" | "fetching" | "playing"

interface PlayPlatformSpeechParams {
  playbackKey: string
  text: string
  language?: string
}

function resolveVoice(language?: string): string {
  const normalizedLanguage = language?.trim()
  if (!normalizedLanguage || normalizedLanguage === "auto") {
    return EDGE_TTS_FALLBACK_VOICE
  }

  return getDefaultTTSVoiceForLanguage(normalizedLanguage as LangCodeISO6393, EDGE_TTS_FALLBACK_VOICE)
}

export function usePlatformTextToSpeech(copy: {
  speechFailed: string
  speechLoading: string
  stopSpeaking: string
}) {
  const [state, setState] = useState<PlaybackState>("idle")
  const [activePlaybackKey, setActivePlaybackKey] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioUrlRef = useRef<string | null>(null)
  const requestIdRef = useRef(0)

  const clearAudio = useCallback(() => {
    const currentAudio = audioRef.current
    if (currentAudio) {
      currentAudio.onended = null
      currentAudio.onerror = null
      currentAudio.pause()
      currentAudio.src = ""
      audioRef.current = null
    }

    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current)
      audioUrlRef.current = null
    }
  }, [])

  const stop = useCallback(() => {
    requestIdRef.current += 1
    clearAudio()
    setState("idle")
    setActivePlaybackKey(null)
  }, [clearAudio])

  useEffect(() => {
    return () => {
      clearAudio()
    }
  }, [clearAudio])

  const play = useCallback(async ({ playbackKey, text, language }: PlayPlatformSpeechParams) => {
    const trimmedText = text.trim()
    if (!trimmedText) {
      return false
    }

    if (activePlaybackKey === playbackKey && state !== "idle") {
      stop()
      return false
    }

    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    clearAudio()
    setActivePlaybackKey(playbackKey)
    setState("fetching")

    try {
      const response = await synthesizeEdgeTTS({
        text: trimmedText,
        voice: resolveVoice(language),
        rate: toSignedValue(0, "%"),
        pitch: toSignedValue(0, "Hz"),
        volume: toSignedValue(0, "%"),
      })

      if (requestIdRef.current !== requestId) {
        return false
      }

      if (!response.ok) {
        throw new Error(`[${response.error.code}] ${response.error.message}`)
      }

      const audioUrl = URL.createObjectURL(new Blob([response.audio], {
        type: response.contentType,
      }))
      const audio = new Audio(audioUrl)
      audioRef.current = audio
      audioUrlRef.current = audioUrl
      audio.onended = () => {
        if (requestIdRef.current !== requestId) {
          return
        }

        clearAudio()
        setState("idle")
        setActivePlaybackKey(null)
      }
      audio.onerror = () => {
        if (requestIdRef.current !== requestId) {
          return
        }

        clearAudio()
        setState("idle")
        setActivePlaybackKey(null)
        toast.error(copy.speechFailed)
      }

      setState("playing")
      await audio.play()
      return true
    }
    catch (error) {
      if (requestIdRef.current !== requestId) {
        return false
      }

      clearAudio()
      setState("idle")
      setActivePlaybackKey(null)
      const normalizedError = error instanceof Error ? error : new Error(String(error))
      toast.error(copy.speechFailed, {
        description: getTTSFriendlyErrorDescription(normalizedError),
      })
      return false
    }
  }, [activePlaybackKey, clearAudio, copy.speechFailed, state, stop])

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
    stop,
    state,
    activePlaybackKey,
    getAriaLabel,
  }
}
