/**
 * Migration script from v070 to v071
 * - Adds `selectionToolbar.features.explain` as a built-in LLM-backed selection feature
 *
 * IMPORTANT: All values are hardcoded inline. Migration scripts are frozen
 * snapshots — never import constants or helpers that may change.
 */

export function migrate(oldConfig: any): any {
  const oldSelectionToolbar = oldConfig?.selectionToolbar ?? {}
  const oldFeatures = oldSelectionToolbar.features ?? {}

  return {
    ...oldConfig,
    selectionToolbar: {
      ...oldSelectionToolbar,
      features: {
        ...oldFeatures,
        explain: {
          ...(oldFeatures.explain ?? {}),
          enabled: oldFeatures.explain?.enabled ?? true,
          providerId: oldFeatures.explain?.providerId ?? oldFeatures.translate?.providerId ?? oldConfig?.translate?.providerId,
        },
      },
    },
  }
}
