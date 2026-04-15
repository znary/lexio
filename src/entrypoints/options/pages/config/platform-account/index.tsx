import { PlatformQuickAccess } from "@/components/platform/platform-quick-access"

export function PlatformAccountMenu() {
  return <PlatformQuickAccess variant="menu" size="sm" className="shrink-0" />
}

export function PlatformAccountCard() {
  return <PlatformAccountMenu />
}
