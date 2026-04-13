declare module "mark.js" {
  export interface MarkOptions {
    acrossElements?: boolean
    accuracy?: "exactly" | "partially" | "complementary" | { value: string, limiters?: string[] }
    caseSensitive?: boolean
    className?: string
    each?: (element: HTMLElement) => void
    exclude?: string[]
    ignoreJoiners?: boolean
    separateWordSearch?: boolean
    done?: () => void
  }

  export default class Mark {
    constructor(ctx: Node | Node[] | NodeList | string)
    mark(keyword: string | string[], options?: MarkOptions): void
    unmark(options?: MarkOptions): void
  }
}
