import { i18n } from "#imports"
import { PageLayout } from "../../components/page-layout"
import { VocabularyLibraryCard } from "../config/vocabulary-library"
import { VocabularySettingsCard } from "../config/vocabulary-settings"

export function VocabularyPage() {
  return (
    <PageLayout title={i18n.t("options.vocabulary.title")} innerClassName="*:border-b [&>*:last-child]:border-b-0">
      <VocabularySettingsCard />
      <VocabularyLibraryCard />
    </PageLayout>
  )
}
