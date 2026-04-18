import { i18n } from "#imports"
import { onMessage } from "@/utils/message"

type ManagedTranslationHoverState = "queued" | "running"

const spinnerElementsByStatusKey = new Map<string, Set<HTMLElement>>()
const hoverStateByStatusKey = new Map<string, ManagedTranslationHoverState>()
let managedTranslationStatusListenerRegistered = false

function getManagedTranslationHoverLabel(state: ManagedTranslationHoverState): string {
  const key = state === "queued"
    ? "translation.loadingStatus.queued"
    : "translation.loadingStatus.translating"
  const translated = i18n.t(key as Parameters<typeof i18n.t>[0])

  if (translated && translated !== key) {
    return translated
  }

  return state === "queued" ? "Queued for translation" : "Translating"
}

function applyManagedTranslationHoverState(
  spinner: HTMLElement,
  state: ManagedTranslationHoverState,
): void {
  const label = getManagedTranslationHoverLabel(state)
  spinner.title = label
  spinner.setAttribute("aria-label", label)
  spinner.dataset.translationLoadingState = state
}

function normalizeManagedTranslationHoverState(state: string): ManagedTranslationHoverState | null {
  if (state === "queued") {
    return "queued"
  }

  if (state === "running") {
    return "running"
  }

  return null
}

function updateManagedTranslationHoverState(statusKey: string, state: ManagedTranslationHoverState | null): void {
  if (state) {
    hoverStateByStatusKey.set(statusKey, state)
  }
  else {
    hoverStateByStatusKey.delete(statusKey)
  }

  const spinners = spinnerElementsByStatusKey.get(statusKey)
  if (!spinners?.size || !state) {
    return
  }

  for (const spinner of spinners) {
    applyManagedTranslationHoverState(spinner, state)
  }
}

function ensureManagedTranslationStatusListener(): void {
  if (managedTranslationStatusListenerRegistered) {
    return
  }

  managedTranslationStatusListenerRegistered = true
  onMessage("notifyManagedTranslationStatus", (message) => {
    const { statusKey, state } = message.data
    updateManagedTranslationHoverState(statusKey, normalizeManagedTranslationHoverState(state))
  })
}

export function bindSpinnerToManagedTranslationStatus(spinner: HTMLElement, statusKey: string): () => void {
  ensureManagedTranslationStatusListener()

  const currentSpinners = spinnerElementsByStatusKey.get(statusKey) ?? new Set<HTMLElement>()
  currentSpinners.add(spinner)
  spinnerElementsByStatusKey.set(statusKey, currentSpinners)

  applyManagedTranslationHoverState(spinner, hoverStateByStatusKey.get(statusKey) ?? "queued")

  return () => {
    const spinners = spinnerElementsByStatusKey.get(statusKey)
    if (!spinners) {
      return
    }

    spinners.delete(spinner)
    if (spinners.size === 0) {
      spinnerElementsByStatusKey.delete(statusKey)
      hoverStateByStatusKey.delete(statusKey)
    }
  }
}
