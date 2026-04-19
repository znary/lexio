// @vitest-environment jsdom
import type { Config } from "@/types/config/config"
import type { SelectionToolbarCustomAction } from "@/types/config/selection-toolbar"
import { i18n } from "#imports"
import { render, screen } from "@testing-library/react"
import { createStore, Provider } from "jotai"
import { describe, expect, it, vi } from "vitest"
import { configAtom } from "@/utils/atoms/config"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { SaveToNotebaseButton } from "../save-to-notebase-button"

vi.mock("@tanstack/react-query", () => ({
  useMutation: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useQuery: () => ({
    data: { fields: [] },
    isPending: false,
    isFetching: false,
  }),
}))

vi.mock("@/utils/auth/auth-client", () => ({
  authClient: {
    useSession: () => ({
      data: {
        user: {
          id: "user-1",
        },
      },
      isPending: false,
    }),
  },
}))

vi.mock("@/utils/notebase-beta", () => ({
  isORPCForbiddenError: () => false,
  useNotebaseBetaStatus: () => ({
    data: {
      allowed: true,
    },
    isPending: false,
    error: null,
  }),
}))

vi.mock("@/utils/notebase", () => ({
  buildNotebaseRowCells: () => ({
    cells: {},
    resolvedMappings: [{ status: "valid" }],
  }),
  isORPCNotFoundError: () => false,
  isORPCUnauthorizedError: () => false,
  isORPCValidationError: () => false,
  sanitizeCustomActionNotebaseConnection: (connection: SelectionToolbarCustomAction["notebaseConnection"]) => connection,
}))

vi.mock("@/utils/orpc/client", () => ({
  orpc: {
    customTable: {
      getSchema: {
        queryOptions: () => ({}),
      },
    },
    row: {
      add: {
        mutationOptions: () => ({}),
      },
    },
  },
}))

function cloneConfig(config: Config): Config {
  return JSON.parse(JSON.stringify(config)) as Config
}

function createAction(): SelectionToolbarCustomAction {
  return {
    id: "action-1",
    name: "Summarize",
    icon: "tabler:sparkles",
    providerId: "provider-1",
    systemPrompt: "system",
    prompt: "prompt",
    outputSchema: [
      {
        id: "field-summary",
        name: "summary",
        type: "string",
        description: "",
        speaking: false,
      },
    ],
    notebaseConnection: {
      tableId: "table-1",
      tableNameSnapshot: "Articles",
      mappings: [],
    },
  }
}

describe("saveToNotebaseButton beta gating", () => {
  it("still renders when beta experience is disabled in config", () => {
    const store = createStore()
    const config = cloneConfig(DEFAULT_CONFIG)

    config.betaExperience.enabled = false
    store.set(configAtom, config)

    render(
      <Provider store={store}>
        <SaveToNotebaseButton
          action={createAction()}
          isRunning={false}
          result={{ summary: "A short summary" }}
        />
      </Provider>,
    )

    expect(screen.getByRole("button", { name: i18n.t("action.saveToNotebase") })).toBeInTheDocument()
  })
})
