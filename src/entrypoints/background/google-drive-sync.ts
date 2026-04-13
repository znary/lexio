import { browser, storage } from "#imports"
import {
  CONFIG_STORAGE_KEY,
  GOOGLE_DRIVE_PENDING_SYNC_STORAGE_KEY,
  GOOGLE_DRIVE_SYNC_RETRY_ALARM_NAME,
  GOOGLE_DRIVE_TOKEN_STORAGE_KEY,
  VOCABULARY_ITEMS_STORAGE_KEY,
} from "@/utils/constants/config"
import { getIsAuthenticated } from "@/utils/google-drive/auth"
import { syncConfig } from "@/utils/google-drive/sync"
import { logger } from "@/utils/logger"

const AUTO_SYNC_DELAY_MS = 5000
const RETRY_DELAY_MINUTES = 1
const STORAGE_EVENT_IGNORE_MS = 1000

let autoSyncTimer: ReturnType<typeof setTimeout> | null = null
let isSyncInFlight = false
let ignoreStorageEventsUntil = 0

async function setPendingSync(pending: boolean) {
  await storage.setItem(`local:${GOOGLE_DRIVE_PENDING_SYNC_STORAGE_KEY}`, pending)
  if (!pending) {
    await browser.alarms.clear(GOOGLE_DRIVE_SYNC_RETRY_ALARM_NAME)
  }
}

async function runGoogleDriveSync(reason: string) {
  if (isSyncInFlight) {
    logger.info("Skip Google Drive auto sync because another sync is already running", { reason })
    return
  }

  if (!(await getIsAuthenticated())) {
    logger.info("Skip Google Drive auto sync because account is not connected", { reason })
    return
  }

  isSyncInFlight = true

  try {
    const result = await syncConfig()

    if (result.status === "success") {
      ignoreStorageEventsUntil = Date.now() + STORAGE_EVENT_IGNORE_MS
      await setPendingSync(false)
      logger.info("Google Drive auto sync completed", { reason, action: result.action })
      return
    }

    await setPendingSync(true)

    if (result.status === "unresolved") {
      logger.warn("Google Drive auto sync requires manual conflict resolution", { reason })
      return
    }

    logger.error("Google Drive auto sync failed", { reason, error: result.error })
    await browser.alarms.create(GOOGLE_DRIVE_SYNC_RETRY_ALARM_NAME, {
      delayInMinutes: RETRY_DELAY_MINUTES,
      periodInMinutes: RETRY_DELAY_MINUTES,
    })
  }
  finally {
    isSyncInFlight = false
  }
}

function scheduleGoogleDriveSync(reason: string, delayMs = AUTO_SYNC_DELAY_MS) {
  if (Date.now() < ignoreStorageEventsUntil) {
    logger.info("Ignore Google Drive auto sync storage event from internal sync write", { reason })
    return
  }

  if (autoSyncTimer) {
    clearTimeout(autoSyncTimer)
  }

  autoSyncTimer = setTimeout(() => {
    autoSyncTimer = null
    void runGoogleDriveSync(reason)
  }, delayMs)
}

export function setupGoogleDriveAutoSync() {
  storage.watch(`local:${CONFIG_STORAGE_KEY}`, () => {
    scheduleGoogleDriveSync("config-updated")
  })

  storage.watch(`local:${VOCABULARY_ITEMS_STORAGE_KEY}`, () => {
    scheduleGoogleDriveSync("vocabulary-updated")
  })

  storage.watch(`local:${GOOGLE_DRIVE_TOKEN_STORAGE_KEY}`, (token) => {
    if (token) {
      scheduleGoogleDriveSync("google-drive-connected", 0)
    }
  })

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === GOOGLE_DRIVE_SYNC_RETRY_ALARM_NAME) {
      void runGoogleDriveSync("retry-alarm")
    }
  })

  void runGoogleDriveSync("background-startup")
}
