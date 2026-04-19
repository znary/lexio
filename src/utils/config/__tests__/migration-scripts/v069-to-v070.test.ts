import { describe, expect, it } from "vitest"
import { migrate } from "../../migration-scripts/v069-to-v070"

describe("v069-to-v070 migration", () => {
  it("removes the old sideContent field", () => {
    const migrated = migrate({
      floatingButton: {
        clickAction: "panel",
      },
      sideContent: {
        width: 480,
      },
      vocabulary: {
        autoSave: true,
      },
    })

    expect(migrated).toEqual({
      floatingButton: {
        clickAction: "panel",
      },
      vocabulary: {
        autoSave: true,
      },
    })
    expect(migrated).not.toHaveProperty("sideContent")
  })
})
