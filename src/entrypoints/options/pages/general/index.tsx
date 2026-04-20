import { i18n } from "#imports"
import { PageLayout } from "../../components/page-layout"
import AppearanceSettings from "./appearance-settings"
import { GeneralQuickSettings } from "./general-quick-settings"
import SiteControlMode from "./site-control-mode"

export function GeneralPage() {
  return (
    <PageLayout title={i18n.t("options.general.title")} innerClassName="*:border-b [&>*:last-child]:border-b-0">
      <GeneralQuickSettings />
      <SiteControlMode />
      <AppearanceSettings />
    </PageLayout>
  )
}
