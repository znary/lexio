import type {
  Edge,
  EdgeProps,
  EdgeTypes,
  Node,
  NodeProps,
  NodeTypes,
} from "@xyflow/react"
import type { VocabularyCardItem, WordFamilyGroupKey } from "./vocabulary-card-data"
import type { VocabularyWordFamily, VocabularyWordFamilyEntry } from "@/types/vocabulary"
import {
  BaseEdge,
  Handle,
  Position,
  ReactFlow,
} from "@xyflow/react"
import { useMemo } from "react"
import { Skeleton } from "@/components/ui/base-ui/skeleton"
import {
  getVocabularyCardDefinition,
  getVocabularyCardPartOfSpeech,
  WORD_FAMILY_GROUP_ORDER,
} from "./vocabulary-card-data"
import "@xyflow/react/dist/style.css"
import "./vocabulary-word-family-mind-map.css"

interface VocabularyWordFamilyMindMapCopy {
  wordFamily: string
  wordFamilyContrast: string
  wordFamilyCore: string
  wordFamilyRelated: string
}

export interface VocabularyWordFamilyMindMapProps {
  copy: VocabularyWordFamilyMindMapCopy
  item: VocabularyCardItem
  loading?: boolean
  wordFamily: VocabularyWordFamily | null
}

type WordFamilyMindMapNodeKind = "entry" | "groupLabel" | "root"

type WordFamilyMindMapNodeData = Record<string, unknown> & {
  definition?: string
  groupKey?: WordFamilyGroupKey
  kind: WordFamilyMindMapNodeKind
  label?: string
  partOfSpeech?: string
  skeleton?: boolean
  term?: string
}

type WordFamilyMindMapNode = Node<WordFamilyMindMapNodeData, "wordFamily">
type WordFamilyMindMapEdge = Edge<Record<string, unknown>, "wordFamilyBranch">

export interface WordFamilyMindMapModel {
  edges: WordFamilyMindMapEdge[]
  nodes: WordFamilyMindMapNode[]
}

const ROOT_NODE_ID = "root"
const ROOT_NODE_HEIGHT = 116
const ENTRY_NODE_HEIGHT = 72
const ENTRY_ROW_GAP = 14
const GROUP_GAP = 30
const GROUP_LABEL_HEIGHT = 26
const ROOT_X = 0
const GROUP_LABEL_X = 218
const ENTRY_X = 346
const WORD_FAMILY_FIT_VIEW_OPTIONS = { padding: 0.08 } as const
const WORD_FAMILY_PRO_OPTIONS = { hideAttribution: true } as const
const SKELETON_GROUP_COUNTS: Record<WordFamilyGroupKey, number> = {
  core: 3,
  contrast: 2,
  related: 2,
}

function getWordFamilyGroupLabel(copy: VocabularyWordFamilyMindMapCopy, groupKey: WordFamilyGroupKey): string {
  switch (groupKey) {
    case "core":
      return copy.wordFamilyCore
    case "contrast":
      return copy.wordFamilyContrast
    case "related":
      return copy.wordFamilyRelated
  }
}

function getGroupLabelNodeId(groupKey: WordFamilyGroupKey): string {
  return `group-label:${groupKey}`
}

function getEntryNodeId(groupKey: WordFamilyGroupKey, index: number): string {
  return `entry:${groupKey}:${index}`
}

function createWordFamilyEntryNodeData(entry: VocabularyWordFamilyEntry | undefined, groupKey: WordFamilyGroupKey): WordFamilyMindMapNodeData {
  if (!entry) {
    return {
      groupKey,
      kind: "entry",
      skeleton: true,
    }
  }

  return {
    definition: entry.definition,
    groupKey,
    kind: "entry",
    partOfSpeech: entry.partOfSpeech,
    term: entry.term,
  }
}

export function buildVocabularyWordFamilyMindMapModel({
  copy,
  item,
  loading = false,
  wordFamily,
}: VocabularyWordFamilyMindMapProps): WordFamilyMindMapModel {
  const nodes: WordFamilyMindMapNode[] = []
  const edges: WordFamilyMindMapEdge[] = []
  let currentY = 0
  const visibleGroupKeys: WordFamilyGroupKey[] = []

  for (const groupKey of WORD_FAMILY_GROUP_ORDER) {
    const entries = wordFamily?.[groupKey] ?? []
    const visibleEntryCount = loading
      ? Math.max(entries.length, SKELETON_GROUP_COUNTS[groupKey])
      : entries.length

    if (visibleEntryCount === 0) {
      continue
    }

    const groupLabelNodeId = getGroupLabelNodeId(groupKey)
    const groupY = currentY
    const firstEntryY = groupY
    const entriesHeight = visibleEntryCount * ENTRY_NODE_HEIGHT
      + Math.max(visibleEntryCount - 1, 0) * ENTRY_ROW_GAP
    const groupCenterY = firstEntryY + entriesHeight / 2

    nodes.push({
      id: groupLabelNodeId,
      type: "wordFamily",
      position: { x: GROUP_LABEL_X, y: groupCenterY - GROUP_LABEL_HEIGHT / 2 },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      draggable: false,
      selectable: false,
      data: {
        groupKey,
        kind: "groupLabel",
        label: getWordFamilyGroupLabel(copy, groupKey),
      },
    })

    visibleGroupKeys.push(groupKey)

    for (let index = 0; index < visibleEntryCount; index++) {
      const entryNodeId = getEntryNodeId(groupKey, index)
      nodes.push({
        id: entryNodeId,
        type: "wordFamily",
        position: {
          x: ENTRY_X,
          y: firstEntryY + index * (ENTRY_NODE_HEIGHT + ENTRY_ROW_GAP),
        },
        targetPosition: Position.Left,
        draggable: false,
        selectable: false,
        data: createWordFamilyEntryNodeData(entries[index], groupKey),
      })

      edges.push({
        id: `edge:${groupLabelNodeId}:${entryNodeId}`,
        source: groupLabelNodeId,
        target: entryNodeId,
        type: "wordFamilyBranch",
        focusable: false,
        selectable: false,
      })
    }

    currentY += entriesHeight + GROUP_GAP
  }

  if (visibleGroupKeys.length === 0) {
    return { edges, nodes }
  }

  const contentHeight = Math.max(currentY - GROUP_GAP, ROOT_NODE_HEIGHT)
  nodes.unshift({
    id: ROOT_NODE_ID,
    type: "wordFamily",
    position: {
      x: ROOT_X,
      y: Math.max(0, contentHeight / 2 - ROOT_NODE_HEIGHT / 2),
    },
    sourcePosition: Position.Right,
    draggable: false,
    selectable: false,
    data: {
      definition: item.definition?.trim() || (!loading ? getVocabularyCardDefinition(item) : ""),
      kind: "root",
      partOfSpeech: getVocabularyCardPartOfSpeech(item),
      term: item.sourceText,
    },
  })

  const rootEdges: WordFamilyMindMapEdge[] = []
  for (const groupKey of visibleGroupKeys) {
    const groupLabelNodeId = getGroupLabelNodeId(groupKey)
    rootEdges.push({
      id: `edge:${ROOT_NODE_ID}:${groupLabelNodeId}`,
      source: ROOT_NODE_ID,
      target: groupLabelNodeId,
      type: "wordFamilyBranch",
      focusable: false,
      selectable: false,
    })
  }

  edges.unshift(...rootEdges)

  return { edges, nodes }
}

function WordFamilyMindMapNodeComponent({ data }: NodeProps<WordFamilyMindMapNode>) {
  const kind = data.kind
  const groupKey = data.groupKey
  const hasTargetHandle = kind === "entry" || kind === "groupLabel"
  const hasSourceHandle = kind === "root" || kind === "groupLabel"
  let content

  if (kind === "root") {
    content = (
      <div className="word-family-map__node word-family-map__node--root">
        <span className="word-family-map__term">{data.term}</span>
        {data.definition
          ? <span className="word-family-map__definition">{data.definition}</span>
          : null}
        {data.partOfSpeech
          ? <span className="word-family-map__part-of-speech">{data.partOfSpeech}</span>
          : null}
      </div>
    )
  }
  else if (kind === "groupLabel") {
    content = (
      <div className={`word-family-map__group-label word-family-map__group-label--${groupKey}`}>
        <span className="word-family-map__group-marker" />
        <span>{data.label}</span>
      </div>
    )
  }
  else if (data.skeleton) {
    content = (
      <div className="word-family-map__node word-family-map__node--entry word-family-map__node--skeleton">
        <div className="word-family-map__entry-copy word-family-map__entry-copy--skeleton">
          <Skeleton className="h-5 w-[76%]" />
          <Skeleton className="h-4 w-[92%]" />
        </div>
        <Skeleton className="h-5 w-12 shrink-0" />
      </div>
    )
  }
  else {
    content = (
      <div className="word-family-map__node word-family-map__node--entry">
        <div className="word-family-map__entry-copy">
          <span className="word-family-map__term">{data.term}</span>
          {data.definition
            ? <span className="word-family-map__definition">{data.definition}</span>
            : null}
        </div>
        {data.partOfSpeech
          ? <span className={`word-family-map__part-of-speech word-family-map__part-of-speech--${groupKey}`}>{data.partOfSpeech}</span>
          : null}
      </div>
    )
  }

  return (
    <>
      {hasTargetHandle
        ? <Handle type="target" position={Position.Left} className="word-family-map__handle" />
        : null}
      {hasSourceHandle
        ? <Handle type="source" position={Position.Right} className="word-family-map__handle" />
        : null}
      {content}
    </>
  )
}

function WordFamilyMindMapBranchEdge({
  id,
  sourceX,
  sourceY,
  style,
  targetX,
  targetY,
}: EdgeProps<WordFamilyMindMapEdge>) {
  const distance = Math.max(targetX - sourceX, 0)
  const elbowX = sourceX + Math.max(8, Math.min(distance * 0.46, 64))
  const path = `M ${sourceX} ${sourceY} C ${elbowX} ${sourceY} ${elbowX} ${targetY} ${targetX} ${targetY}`

  return (
    <BaseEdge
      id={id}
      path={path}
      className="word-family-map__edge"
      style={style}
      interactionWidth={0}
    />
  )
}

const nodeTypes = {
  wordFamily: WordFamilyMindMapNodeComponent,
} satisfies NodeTypes

const edgeTypes = {
  wordFamilyBranch: WordFamilyMindMapBranchEdge,
} satisfies EdgeTypes

export function VocabularyWordFamilyMindMap({
  copy,
  item,
  loading = false,
  wordFamily,
}: VocabularyWordFamilyMindMapProps) {
  const wordFamilyKey = wordFamily ? JSON.stringify(wordFamily) : null

  const { edges, nodes } = useMemo(
    () => buildVocabularyWordFamilyMindMapModel({ copy, item, loading, wordFamily }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      copy.wordFamilyCore, copy.wordFamilyContrast, copy.wordFamilyRelated,
      item.sourceText, item.definition, item.partOfSpeech, item.kind,
      loading, wordFamilyKey,
    ],
  )

  if (nodes.length === 0) {
    return null
  }

  return (
    <div
      className={`word-bank-family word-family-map${loading ? " word-bank-family--skeleton word-family-map--loading" : ""}`}
      aria-label={copy.wordFamily}
      data-testid="word-family-mind-map"
    >
      <div className="word-bank-family__header">{copy.wordFamily}</div>
      <div className="word-family-map__canvas" aria-hidden="true">
        <ReactFlow<WordFamilyMindMapNode, WordFamilyMindMapEdge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={WORD_FAMILY_FIT_VIEW_OPTIONS}
          minZoom={0.35}
          maxZoom={1}
          nodesDraggable={false}
          nodesConnectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          elementsSelectable={false}
          panOnDrag={false}
          panOnScroll={false}
          zoomOnScroll={false}
          zoomOnPinch={false}
          zoomOnDoubleClick={false}
          preventScrolling={false}
          proOptions={WORD_FAMILY_PRO_OPTIONS}
        />
      </div>
    </div>
  )
}
