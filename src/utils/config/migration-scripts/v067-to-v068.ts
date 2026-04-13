/**
 * Migration script from v067 to v068
 * - Adds vocabulary settings for auto-save and page highlighting.
 *
 * IMPORTANT: All values are hardcoded inline. Migration scripts are frozen
 * snapshots — never import constants or helpers that may change.
 */

export function migrate(oldConfig: any): any {
  return {
    ...oldConfig,
    vocabulary: {
      autoSave: oldConfig?.vocabulary?.autoSave ?? true,
      highlightEnabled: oldConfig?.vocabulary?.highlightEnabled ?? true,
      maxPhraseWords: oldConfig?.vocabulary?.maxPhraseWords ?? 8,
      highlightColor: oldConfig?.vocabulary?.highlightColor ?? "#fde68a",
    },
  }
}
