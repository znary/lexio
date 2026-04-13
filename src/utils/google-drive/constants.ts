import { kebabCase } from "case-anything"
import { APP_NAME } from "../constants/app"

const appSlug = kebabCase(APP_NAME)
  .replace(/[^a-z0-9-]/g, "-")
  .replace(/-+/g, "-")
  .replace(/^-|-$/g, "")

export const GOOGLE_DRIVE_CONFIG_FILENAME = `${appSlug || "extension"}-sync-data.json`
