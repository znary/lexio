import { i18n } from "#imports"
import { PlatformQuickAccess } from "@/components/platform/platform-quick-access"
import { PageLayout } from "../../components/page-layout"
import AppearanceSettings from "./appearance-settings"
import LanguageDetectionConfig from "./language-detection-config"
import SiteControlMode from "./site-control-mode"

export function GeneralPage() {
  return (
    <PageLayout title={i18n.t("options.general.title")} innerClassName="*:border-b [&>*:last-child]:border-b-0">
      <PlatformQuickAccess />
      <LanguageDetectionConfig />
      <SiteControlMode />
      <AppearanceSettings />
    </PageLayout>
  )
}
