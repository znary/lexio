import type { ComponentType } from "react"
import { lazy, Suspense } from "react"
import { Route, Routes } from "react-router"
import { ROUTE_DEFS } from "./app-sidebar/nav-items"
import { GeneralPage } from "./pages/general"

type RoutePath = (typeof ROUTE_DEFS)[number]["path"]

const TranslationPage = lazy(() => import("./pages/translation").then(module => ({ default: module.TranslationPage })))
const VideoSubtitlesPage = lazy(() => import("./pages/video-subtitles").then(module => ({ default: module.VideoSubtitlesPage })))
const FloatingButtonPage = lazy(() => import("./pages/floating-button").then(module => ({ default: module.FloatingButtonPage })))
const SelectionToolbarPage = lazy(() => import("./pages/selection-toolbar").then(module => ({ default: module.SelectionToolbarPage })))
const ContextMenuPage = lazy(() => import("./pages/context-menu").then(module => ({ default: module.ContextMenuPage })))
const InputTranslationPage = lazy(() => import("./pages/input-translation").then(module => ({ default: module.InputTranslationPage })))
const VocabularyPage = lazy(() => import("./pages/vocabulary").then(module => ({ default: module.VocabularyPage })))
const TextToSpeechPage = lazy(() => import("./pages/text-to-speech").then(module => ({ default: module.TextToSpeechPage })))
const StatisticsPage = lazy(() => import("./pages/statistics").then(module => ({ default: module.StatisticsPage })))
const ConfigPage = lazy(() => import("./pages/config").then(module => ({ default: module.ConfigPage })))

const ROUTE_COMPONENTS: Record<RoutePath, ComponentType> = {
  "/": GeneralPage,
  "/translation": TranslationPage,
  "/video-subtitles": VideoSubtitlesPage,
  "/floating-button": FloatingButtonPage,
  "/selection-toolbar": SelectionToolbarPage,
  "/context-menu": ContextMenuPage,
  "/input-translation": InputTranslationPage,
  "/vocabulary": VocabularyPage,
  "/tts": TextToSpeechPage,
  "/statistics": StatisticsPage,
  "/config": ConfigPage,
}

function RouteLoadingFallback() {
  return (
    <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
      Loading settings...
    </div>
  )
}

export default function App() {
  return (
    <Suspense fallback={<RouteLoadingFallback />}>
      <Routes>
        {ROUTE_DEFS.map(({ path }) => {
          const Component = ROUTE_COMPONENTS[path]
          return <Route key={path} path={path} element={<Component />} />
        })}
      </Routes>
    </Suspense>
  )
}
