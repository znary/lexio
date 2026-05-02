// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { VocabularyDetailCard } from "../vocabulary-detail-card"
import { buildVocabularyWordFamilyMindMapModel } from "../vocabulary-word-family-mind-map"

const copy = {
  definition: "Definition",
  inContext: "In Context",
  mastered: "Mastered",
  missingContext: "No context captured yet.",
  practiceNow: "Practice Now",
  wordFamily: "Word Family",
  wordFamilyContrast: "Contrast",
  wordFamilyCore: "Core",
  wordFamilyRelated: "Related",
}

describe("vocabularyDetailCard", () => {
  it("builds word family mind map nodes in stable display order", () => {
    const model = buildVocabularyWordFamilyMindMapModel({
      copy,
      loading: false,
      item: {
        sourceText: "capability",
        translatedText: "能力，功能",
        definition: "能力，功能",
        partOfSpeech: "noun",
      },
      wordFamily: {
        core: [
          { term: "capable", partOfSpeech: "adj", definition: "有能力的，能干的" },
          { term: "capably", partOfSpeech: "adv", definition: "有能力地，能干地" },
        ],
        contrast: [
          { term: "ability", partOfSpeech: "noun", definition: "能力，才能" },
        ],
        related: [
          { term: "feature", partOfSpeech: "noun", definition: "特性，功能" },
        ],
      },
    })

    expect(model.nodes.map(node => node.id)).toEqual([
      "root",
      "group-label:core",
      "entry:core:0",
      "entry:core:1",
      "group-label:contrast",
      "entry:contrast:0",
      "group-label:related",
      "entry:related:0",
    ])
    expect(model.edges.slice(0, 3).map(edge => edge.id)).toEqual([
      "edge:root:group-label:core",
      "edge:root:group-label:contrast",
      "edge:root:group-label:related",
    ])
    expect(model.nodes.find(node => node.id === "entry:core:0")?.data).toMatchObject({
      groupKey: "core",
      kind: "entry",
      partOfSpeech: "adj",
      term: "capable",
    })
    expect(model.nodes.find(node => node.id === "group-label:core")?.data).toMatchObject({
      groupKey: "core",
      kind: "groupLabel",
      label: "Core",
    })
  })

  it("centers group labels against entry stacks", () => {
    const model = buildVocabularyWordFamilyMindMapModel({
      copy,
      loading: false,
      item: {
        sourceText: "handful",
        translatedText: "少数，几个",
        definition: "少数，几个",
        partOfSpeech: "noun",
      },
      wordFamily: {
        core: [
          { term: "handful", partOfSpeech: "noun", definition: "少数，几个" },
          { term: "handful", partOfSpeech: "noun", definition: "一把（的量）" },
          { term: "handful", partOfSpeech: "noun", definition: "难管教的人" },
        ],
        contrast: [],
        related: [],
      },
    })

    const groupLabel = model.nodes.find(node => node.id === "group-label:core")
    const entries = model.nodes.filter(node => node.id.startsWith("entry:core:"))
    const entryCenters = entries.map(node => node.position.y + 36)
    const entryStackCenter = (Math.min(...entryCenters) + Math.max(...entryCenters)) / 2
    const labelCenter = (groupLabel?.position.y ?? 0) + 13

    expect(labelCenter).toBe(entryStackCenter)
  })

  it("builds the same mind map structure for loading skeleton branches", () => {
    const model = buildVocabularyWordFamilyMindMapModel({
      copy,
      loading: true,
      item: {
        sourceText: "capability",
        translatedText: "能力，功能",
        partOfSpeech: "noun",
      },
      wordFamily: null,
    })

    expect(model.nodes.map(node => node.id)).toEqual([
      "root",
      "group-label:core",
      "entry:core:0",
      "entry:core:1",
      "entry:core:2",
      "group-label:contrast",
      "entry:contrast:0",
      "entry:contrast:1",
      "group-label:related",
      "entry:related:0",
      "entry:related:1",
    ])
    expect(model.nodes.filter(node => node.data.skeleton).length).toBe(7)
  })

  it("keeps stable skeleton node ids while streaming entries arrive", () => {
    const emptyLoadingModel = buildVocabularyWordFamilyMindMapModel({
      copy,
      loading: true,
      item: {
        sourceText: "capability",
        translatedText: "能力，功能",
        partOfSpeech: "noun",
      },
      wordFamily: null,
    })
    const model = buildVocabularyWordFamilyMindMapModel({
      copy,
      loading: true,
      item: {
        sourceText: "capability",
        translatedText: "能力，功能",
        partOfSpeech: "noun",
      },
      wordFamily: {
        core: [
          { term: "capable", partOfSpeech: "adj", definition: "有能力的，能干的" },
        ],
        contrast: [],
        related: [],
      },
    })

    expect(model.nodes.map(node => node.id)).toEqual(emptyLoadingModel.nodes.map(node => node.id))
    const arrivedEntry = model.nodes.find(node => node.id === "entry:core:0")
    expect(arrivedEntry?.data.term).toBe("capable")
    expect(arrivedEntry?.data.skeleton).toBeUndefined()
    expect(model.nodes.find(node => node.id === "entry:core:1")?.data).toMatchObject({
      groupKey: "core",
      kind: "entry",
      skeleton: true,
    })
    expect(model.nodes.filter(node => node.data.skeleton).length).toBe(6)
  })

  it("renders the generated word family groups without making entries interactive", () => {
    render(
      <VocabularyDetailCard
        variant="page"
        copy={copy}
        item={{
          id: "item-1",
          sourceText: "independent",
          translatedText: "独立的",
          definition: "独立的，不依赖他人的",
          partOfSpeech: "adjective",
          phonetic: "/ˌɪndɪˈpendənt/",
          wordFamily: {
            core: [
              { term: "independence", partOfSpeech: "noun", definition: "独立，自主" },
            ],
            contrast: [
              { term: "dependent", partOfSpeech: "adjective", definition: "依赖的" },
            ],
            related: [
              { term: "depend", partOfSpeech: "verb", definition: "依靠，取决于" },
            ],
          },
          contextEntries: [
            { sentence: "The team worked independently across three groups." },
          ],
        }}
        practiceHref="/practice?start=item-1"
      />,
    )

    expect(screen.getByLabelText("Word Family")).toBeInTheDocument()
    expect(screen.getByText("Core")).toBeInTheDocument()
    expect(screen.getByText("Contrast")).toBeInTheDocument()
    expect(screen.getByText("Related")).toBeInTheDocument()
    expect(screen.getByText("independence")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "independence noun" })).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Practice Now" })).toHaveAttribute("href", "/practice?start=item-1")
  })

  it("does not reserve the word family column when there is no word family", () => {
    const { container } = render(
      <VocabularyDetailCard
        variant="page"
        copy={copy}
        item={{
          id: "item-1",
          sourceText: "collide",
          translatedText: "碰撞",
          definition: "to hit something",
          partOfSpeech: "verb",
        }}
      />,
    )

    expect(screen.queryByLabelText("Word Family")).toBeNull()
    expect(container.querySelector(".word-bank-detail__layout.has-family")).toBeNull()
  })

  it("marks long text fields with wrapping classes and exposes page and popover variants", () => {
    const longText = "translated-without-breaks.example/".repeat(4)
    const { rerender } = render(
      <VocabularyDetailCard
        variant="popover"
        copy={copy}
        item={{
          sourceText: "source-without-breaks.example/".repeat(4),
          translatedText: longText,
          definition: longText,
          contextEntries: [{ sentence: longText }],
        }}
      />,
    )

    expect(screen.getByTestId("vocabulary-detail-card")).toHaveAttribute("data-variant", "popover")
    expect(screen.getByTestId("vocabulary-detail-card")).toHaveClass("word-bank-detail")
    expect(screen.getByText(longText)).toHaveClass("vocabulary-detail-card__wrap")

    rerender(
      <VocabularyDetailCard
        variant="page"
        copy={copy}
        item={{
          sourceText: "source",
          translatedText: "译文",
          definition: "释义",
        }}
      />,
    )

    expect(screen.getByTestId("vocabulary-detail-card")).toHaveAttribute("data-variant", "page")
  })

  it("shows up to three source-language context entries in the popover", () => {
    render(
      <VocabularyDetailCard
        variant="popover"
        copy={copy}
        item={{
          sourceText: "incoming",
          translatedText: "传入的",
          definition: "传入的",
          sourceLang: "auto",
          targetLang: "cmn",
          contextEntries: [
            {
              sentence: "Vercel Functions are priced based on active CPU.",
              translatedSentence: "Vercel 函数的定价基于活跃 CPU。",
            },
            {
              sentence: "VOID scans data sources and imports provision databases.",
              translatedSentence: "VOID 会扫描数据源。",
            },
            {
              sentence: "The runtime records incoming requests.",
              translatedSentence: "运行时会记录传入请求。",
            },
            {
              sentence: "The fourth context should not be visible.",
              translatedSentence: "第四条不应该显示。",
            },
          ],
        }}
      />,
    )

    expect(screen.getByText(/Vercel Functions are priced/)).toBeInTheDocument()
    expect(screen.getByText("Vercel 函数的定价基于活跃 CPU。")).toBeInTheDocument()
    expect(screen.getByText(/VOID scans data sources/)).toBeInTheDocument()
    expect(screen.getByText("VOID 会扫描数据源。")).toBeInTheDocument()
    expect(screen.getByText(/The runtime records incoming requests/)).toBeInTheDocument()
    expect(screen.getByText("运行时会记录传入请求。")).toBeInTheDocument()
    expect(screen.queryByText(/The fourth context should not be visible/)).toBeNull()
  })

  it("does not render target-language text as a quoted source context", () => {
    render(
      <VocabularyDetailCard
        variant="popover"
        copy={copy}
        item={{
          sourceText: "provision",
          translatedText: "预配",
          definition: "预配",
          sourceLang: "auto",
          targetLang: "cmn",
          contextEntries: [
            {
              sentence: "Vercel Functions provision resources automatically.",
              translatedSentence: "Vercel 函数会自动预配资源。",
            },
            {
              sentence: "资源堆断：VOID 通过扫描源码推断所需资源，如 import DB from voy-db 时自动 provision 数据库。",
              translatedSentence: "资源堆断：VOID 通过扫描源码推断所需资源。",
            },
          ],
        }}
      />,
    )

    expect(screen.getByText(/Vercel Functions provision resources automatically/)).toBeInTheDocument()
    expect(screen.getByText("Vercel 函数会自动预配资源。")).toBeInTheDocument()
    expect(screen.queryByText(/资源堆断/)).toBeNull()
  })
})
