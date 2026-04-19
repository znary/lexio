/**
 * Migration script from v069 to v070
 * - Removes the legacy injected side-content width setting.
 *
 * IMPORTANT: Migration scripts are frozen snapshots.
 */

export function migrate(oldConfig: any): any {
  const { sideContent: _sideContent, ...rest } = oldConfig ?? {}
  return rest
}
