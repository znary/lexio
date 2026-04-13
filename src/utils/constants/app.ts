import { browser } from "#imports"
import { kebabCase } from "case-anything"

export const APP_NAME = import.meta.env.WXT_APP_NAME || "Lexio"
export const APP_SIDE_CONTENT_HOST_NAME = `${kebabCase(APP_NAME)}-side`
const manifest = browser.runtime.getManifest()
export const EXTENSION_VERSION = manifest.version
