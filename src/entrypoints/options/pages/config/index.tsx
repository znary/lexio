import { i18n } from "#imports"
import { PageLayout } from "../../components/page-layout"
import { AboutCard } from "./about-card"
import { BetaExperienceConfig } from "./beta-experience"
import { ConfigBackup } from "./config-backup"
import { GoogleDriveSyncCard } from "./google-drive-sync"
import { ManualConfigSync } from "./manual-config-sync"
import { ResetConfig } from "./reset-config"
import { VocabularyLibraryCard } from "./vocabulary-library"
import { VocabularySettingsCard } from "./vocabulary-settings"

export function ConfigPage() {
  return (
    <PageLayout title={i18n.t("options.config.title")} innerClassName="*:border-b [&>*:last-child]:border-b-0">
      <BetaExperienceConfig />
      <GoogleDriveSyncCard />
      <VocabularySettingsCard />
      <VocabularyLibraryCard />
      <ManualConfigSync />
      <ConfigBackup />
      <AboutCard />
      <ResetConfig />
    </PageLayout>
  )
}
