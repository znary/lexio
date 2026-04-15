import { i18n } from "#imports"
import { IconSearch } from "@tabler/icons-react"
import { useSetAtom } from "jotai"
import lexioLogo from "@/assets/icons/lexio.svg"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/base-ui/input-group"
import { Kbd } from "@/components/ui/base-ui/kbd"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "@/components/ui/base-ui/sidebar"
import { WEBSITE_URL } from "@/utils/constants/url"
import { getCommandPaletteShortcutHint } from "@/utils/os"
import { version } from "../../../../package.json"
import { commandPaletteOpenAtom } from "../command-palette/atoms"
import { PlatformAccountMenu } from "../pages/config/platform-account"
import { SettingsNav } from "./settings-nav"
import { ToolsNav } from "./tools-nav"
import { WhatsNewFooter } from "./whats-new-footer"

export function AppSidebar() {
  const setCommandPaletteOpen = useSetAtom(commandPaletteOpenAtom)
  const commandPaletteShortcutHint = getCommandPaletteShortcutHint()

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="group-data-[state=expanded]:px-5 group-data-[state=expanded]:pt-4 transition-all">
        <div className="flex items-center justify-between gap-3">
          <a href={WEBSITE_URL} className="flex min-w-0 items-center gap-2">
            <img src={lexioLogo} alt={`${i18n.t("name")} logo`} className="h-8 w-8 shrink-0" />
            <span className="text-md font-bold overflow-hidden truncate group-data-[state=collapsed]:hidden">{i18n.t("name")}</span>
            <span className="text-xs text-muted-foreground overflow-hidden truncate group-data-[state=collapsed]:hidden">
              {`v${version}`}
            </span>
          </a>
          <PlatformAccountMenu />
        </div>
        <InputGroup
          onClick={() => setCommandPaletteOpen(true)}
          className="mt-3 bg-background"
        >
          <InputGroupInput
            readOnly
            placeholder={i18n.t("options.commandPalette.placeholder")}
            className="cursor-pointer"
          />
          <InputGroupAddon>
            <IconSearch className="size-4 text-muted-foreground group-data-[state=collapsed]:-mx-px" />
          </InputGroupAddon>
          <InputGroupAddon
            align="inline-end"
            className="group-data-[state=collapsed]:hidden"
          >
            <Kbd>{commandPaletteShortcutHint}</Kbd>
          </InputGroupAddon>
        </InputGroup>
      </SidebarHeader>
      <SidebarContent className="group-data-[state=expanded]:px-2 transition-all">
        <SettingsNav />
        <ToolsNav />
      </SidebarContent>
      <SidebarFooter className="group-data-[state=expanded]:px-2 transition-all">
        <WhatsNewFooter />
      </SidebarFooter>
    </Sidebar>
  )
}
