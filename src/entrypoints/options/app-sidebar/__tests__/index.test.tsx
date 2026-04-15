// @vitest-environment jsdom
import type { ComponentProps, ReactNode } from "react"
import { render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AppSidebar } from "../index"

vi.mock("#imports", () => ({
  i18n: {
    t: (key: string) => key,
  },
}))

vi.mock("@/assets/icons/lexio.svg", () => ({
  default: "lexio.svg",
}))

vi.mock("@/components/ui/base-ui/input-group", () => ({
  InputGroup: ({ children, ...props }: ComponentProps<"div">) => <div {...props}>{children}</div>,
  InputGroupAddon: ({ children, ...props }: ComponentProps<"div">) => <div {...props}>{children}</div>,
  InputGroupInput: (props: ComponentProps<"input">) => <input {...props} />,
}))

vi.mock("@/components/ui/base-ui/kbd", () => ({
  Kbd: ({ children }: { children: ReactNode }) => <kbd>{children}</kbd>,
}))

vi.mock("@/components/ui/base-ui/sidebar", () => ({
  Sidebar: ({ children }: { children: ReactNode }) => <aside>{children}</aside>,
  SidebarContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarFooter: ({ children }: { children: ReactNode }) => <footer>{children}</footer>,
  SidebarHeader: ({ children }: { children: ReactNode }) => <header data-testid="sidebar-header">{children}</header>,
}))

vi.mock("@/utils/os", () => ({
  getCommandPaletteShortcutHint: () => "⌘K",
}))

vi.mock("../../command-palette/atoms", () => ({
  commandPaletteOpenAtom: {},
}))

vi.mock("jotai", () => ({
  useSetAtom: () => vi.fn(),
}))

vi.mock("../../pages/config/platform-account", () => ({
  PlatformAccountMenu: () => (
    <button type="button" aria-label="Open account menu">
      Account
    </button>
  ),
}))

vi.mock("../settings-nav", () => ({
  SettingsNav: () => <div>settings nav</div>,
}))

vi.mock("../tools-nav", () => ({
  ToolsNav: () => <div>tools nav</div>,
}))

vi.mock("../whats-new-footer", () => ({
  WhatsNewFooter: () => <div>whats new</div>,
}))

afterEach(() => {
  vi.clearAllMocks()
})

describe("appSidebar", () => {
  it("places the account menu in the sidebar header", () => {
    render(<AppSidebar />)

    const header = screen.getByTestId("sidebar-header")
    expect(within(header).getByLabelText("Open account menu")).toBeInTheDocument()
    expect(screen.getByPlaceholderText("options.commandPalette.placeholder")).toBeInTheDocument()
  })
})
