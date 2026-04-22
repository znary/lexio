import type { SVGProps } from "react"

type IconProps = SVGProps<SVGSVGElement>

function BaseIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    />
  )
}

export function AccountOutlineIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="9" r="3" />
      <path d="M6.8 18.2c1.3-2 3-3 5.2-3s3.9 1 5.2 3" />
    </BaseIcon>
  )
}

export function SearchIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <circle cx="10.5" cy="10.5" r="5.2" />
      <path d="M15 15l4.2 4.2" />
    </BaseIcon>
  )
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M7 10l5 5 5-5" />
    </BaseIcon>
  )
}

export function GlobeIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <circle cx="12" cy="12" r="8" />
      <path d="M4.8 12h14.4" />
      <path d="M12 4a12.4 12.4 0 0 1 0 16" />
      <path d="M12 4a12.4 12.4 0 0 0 0 16" />
    </BaseIcon>
  )
}

export function MoonIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M16.7 14.6a5.9 5.9 0 0 1-7.3-7.3 7 7 0 1 0 7.3 7.3Z" />
      <path d="M17.8 5.8v2.2" />
      <path d="M16.7 6.9H19" />
    </BaseIcon>
  )
}

export function BookmarkPlusIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M7 4.5h10a1 1 0 0 1 1 1V19.5l-6-3.3-6 3.3V5.5a1 1 0 0 1 1-1Z" />
      <path d="M15.5 6.8v4.2" />
      <path d="M13.4 8.9h4.2" />
    </BaseIcon>
  )
}

export function KeyboardIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <rect x="3.5" y="6.5" width="17" height="11" rx="2.5" />
      <path d="M6.8 10.4h0.01" />
      <path d="M10.1 10.4h0.01" />
      <path d="M13.4 10.4h0.01" />
      <path d="M16.7 10.4h0.01" />
      <path d="M6.8 13.6h7.4" />
      <path d="M16.7 13.6h0.01" />
    </BaseIcon>
  )
}

export function RestartIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M8.4 8.6A5.8 5.8 0 1 1 6 13.2" />
      <path d="M8.6 5.8v3.5H5.1" />
    </BaseIcon>
  )
}

export function TuningIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M4.5 6h5" />
      <path d="M12.5 6h7" />
      <path d="M8.2 4v4" />
      <path d="M4.5 12h9" />
      <path d="M16.8 10v4" />
      <path d="M18.8 12h.7" />
      <path d="M4.5 18h3" />
      <path d="M10.5 18h9" />
      <path d="M8.8 16v4" />
    </BaseIcon>
  )
}

export function SpeakerIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M5 10h3.3l4.1-3.5v11l-4.1-3.5H5Z" />
      <path d="M15.8 9.3a4.6 4.6 0 0 1 0 5.4" />
      <path d="M18.3 7a7.8 7.8 0 0 1 0 10" />
    </BaseIcon>
  )
}

export function PracticeSparkIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M7.5 6.2l10.3 10.3" />
      <path d="M6.2 7.5l10.3 10.3" />
      <path d="M14.8 5.5l.8-2.5" />
      <path d="M18.5 9.2 21 8.4" />
      <path d="M8.8 18.5 8 21" />
      <path d="M5.5 14.8 3 15.6" />
    </BaseIcon>
  )
}

export function PlayTriangleIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M8.5 6.8 18 12l-9.5 5.2Z" fill="currentColor" stroke="none" />
    </BaseIcon>
  )
}

export function BookIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M6.2 5.5h9.2a2.1 2.1 0 0 1 2.1 2.1v10.9a16.7 16.7 0 0 0-6-1.2 14.3 14.3 0 0 0-5.3 1.1V7.2a1.7 1.7 0 0 1 1.7-1.7Z" />
      <path d="M8.5 8.8h5.8" />
      <path d="M8.5 11.6h5.8" />
    </BaseIcon>
  )
}

export function ClockIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.8v4.6l2.9 1.7" />
    </BaseIcon>
  )
}

export function SpeedIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M5.5 16.5a7.5 7.5 0 1 1 13 0" />
      <path d="M12 12l3.2-2" />
      <path d="M8.4 17.4h7.2" />
    </BaseIcon>
  )
}

export function CheckCircleIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <circle cx="12" cy="12" r="8" />
      <path d="m8.8 12 2.2 2.2 4.2-4.4" />
    </BaseIcon>
  )
}

export function TargetIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <circle cx="12" cy="12" r="7.5" />
      <circle cx="12" cy="12" r="3.3" />
      <path d="M12 4.5V2.8" />
      <path d="M12 21.2v-1.7" />
      <path d="M19.5 12h1.7" />
      <path d="M2.8 12h1.7" />
    </BaseIcon>
  )
}

export function ProfileCircleIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="9.4" r="2.2" />
      <path d="M8.4 16.2c1.1-1.6 2.3-2.4 3.6-2.4s2.5.8 3.6 2.4" />
    </BaseIcon>
  )
}

export function SyncCycleIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M8.2 7.7a5.9 5.9 0 0 1 7.8-.8l1.2 1" />
      <path d="M16.5 5.8v3.3h-3.2" />
      <path d="M15.8 16.3a5.9 5.9 0 0 1-7.8.8l-1.2-1" />
      <path d="M7.5 18.2v-3.3h3.2" />
    </BaseIcon>
  )
}

export function ExtensionDocumentIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M8 3.8h6.7l3.3 3.2v10.8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-12a2 2 0 0 1 2-2Z" />
      <path d="M14.7 3.8V7h3.3" />
      <path d="M11.4 9.1h1.5a1.7 1.7 0 0 1 1.7 1.7v.4h.4a1.7 1.7 0 0 1 0 3.4h-.4v.4a1.7 1.7 0 0 1-3.4 0v-.4h-.4a1.7 1.7 0 1 1 0-3.4h.4v-.4a1.7 1.7 0 0 1 .2-.8Z" />
    </BaseIcon>
  )
}

export function LockIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <rect x="6.5" y="11" width="11" height="8.5" rx="2" />
      <path d="M9 11V8.8a3 3 0 0 1 6 0V11" />
    </BaseIcon>
  )
}
