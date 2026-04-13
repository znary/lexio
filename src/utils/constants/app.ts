import { browser } from "#imports"

export const APP_NAME = import.meta.env.WXT_APP_NAME || "English Companion"
const manifest = browser.runtime.getManifest()
export const EXTENSION_VERSION = manifest.version
