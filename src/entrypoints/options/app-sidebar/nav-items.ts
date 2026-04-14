export const ROUTE_DEFS = [
  { path: "/" },
  { path: "/custom-actions" },
  { path: "/translation" },
  { path: "/video-subtitles" },
  { path: "/floating-button" },
  { path: "/selection-toolbar" },
  { path: "/context-menu" },
  { path: "/input-translation" },
  { path: "/vocabulary" },
  ...(import.meta.env.BROWSER === "firefox" ? [] : [{ path: "/tts" }]),
  { path: "/statistics" },
  { path: "/config" },
] as const
