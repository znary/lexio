import { browser } from "#imports"
import { kebabCase } from "case-anything"
import * as React from "react"

import { Toaster } from "sonner"
import brandIcon from "@/assets/icons/lexio.svg?url&no-inline"
import { APP_NAME } from "@/utils/constants/app"

const brandIconUrl = new URL(brandIcon, browser.runtime.getURL("/")).href

const brandIconElement = (
  <img
    src={brandIconUrl}
    alt={APP_NAME}
    style={{
      maxWidth: "100%",
      height: "auto",
      minHeight: "20px",
      minWidth: "20px",
    }}
  />
)

function BrandToast({ position = "bottom-left", toastOptions, ...props }: React.ComponentProps<typeof Toaster>) {
  return (
    <Toaster
      {...props}
      position={position}
      richColors
      icons={{
        warning: brandIconElement,
        success: brandIconElement,
        error: brandIconElement,
        info: brandIconElement,
        loading: brandIconElement,
      }}
      toastOptions={{
        ...toastOptions,
        className: [`${kebabCase(APP_NAME)}-toaster`, toastOptions?.className].filter(Boolean).join(" "),
      }}
      className="z-[2147483647] notranslate"
    />
  )
}

export default BrandToast
