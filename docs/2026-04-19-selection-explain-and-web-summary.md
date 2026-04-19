# 划词 AI 解释 / 当前网页总结调研

## 目的

这份文档回答两个问题：

1. 现在仓库里已经有哪些能力可以直接复用。
2. 后续如果要做“划词 AI 解释”和“当前网页总结”，最小改动应该落在哪一层。

结论先写在前面：

- 划词 AI 解释应做成 `selection toolbar` 的内置入口，并补一个右键菜单入口。
- 执行层应复用现有 `custom action + structured object stream` 链路，不再新做一套 Explain 专用流式框架。
- 当前网页总结应做成页面级入口，不要塞进划词工具栏。
- 当前网页总结的正文提取、摘要生成、缓存，应直接复用现有 `Readability -> webPageContext -> background summary queue -> Dexie cache` 这条链路。
- 页面级入口优先放在 `sidepanel`，不要回到已经移除的旧 `side.content` 方案。

## 当前可复用能力

### 1. 划词快照和上下文已经齐了

`src/entrypoints/selection.content/utils.ts` 已经提供：

- `readSelectionSnapshot`
- `buildContextSnapshot`
- 多 range / Shadow DOM 兼容
- 选区所在段落抽取

`src/entrypoints/selection.content/selection-toolbar/atoms.ts` 已经把这些信息收口成 `SelectionSession`：

- `selectionSnapshot`
- `contextSnapshot`
- `selectionSessionAtom`

这意味着“AI 解释”不需要再自己做选区读取、段落拼接、上下文裁剪。

### 2. 右键菜单已经能回到同一批划词会话

`src/entrypoints/background/context-menu.ts` 已有两种能力：

- `openSelectionTranslationFromContextMenu`
- `openSelectionCustomActionFromContextMenu`

`src/entrypoints/selection.content/selection-toolbar/use-selection-context-menu-request.ts` 已经缓存了右键触发时的：

- anchor 坐标
- 选区 session
- 10 秒内的快照复用

这意味着“Explain”右键入口只需要补一个新的 menu id 和 message type，不需要重新发明选区恢复逻辑。

### 3. 自定义 AI 动作已经是一条完整执行链

现有自定义动作链路由这些部分组成：

- `src/entrypoints/selection.content/selection-toolbar/custom-action-button/provider.tsx`
- `src/entrypoints/selection.content/selection-toolbar/custom-action-button/use-custom-action-execution.ts`
- `src/types/config/selection-toolbar.ts`

它已经支持：

- 动作配置
- provider 解析
- prompt token 替换
- 结构化输出 schema
- background structured object streaming
- rerun / abort / 错误处理

现在 selection toolbar 里的“自定义动作按钮”本质上只是这个执行链的 UI 外壳。  
因此，“Explain”最省事的做法不是复制 `TranslateButton` 的实现，而是给内置 Explain 包一层固定配置，再复用这条动作执行链。

### 4. 当前网页正文提取和摘要缓存已经存在

现有网页级上下文链路如下：

- `src/utils/host/translate/webpage-context.ts`
  - 用 `Readability` 提取正文
  - 缓存 `webTitle` 和 `webContent`
- `src/utils/host/translate/webpage-summary.ts`
  - 通过 message 向 background 请求摘要
- `src/entrypoints/background/translation-queues.ts`
  - `getOrGenerateWebPageSummary`
  - 请求去重
  - Dexie 缓存
- `src/utils/content/summary.ts`
  - LLM 摘要生成

这条链路已经被 page translation 和 selection translation 的 AI-aware prompt 复用。  
所以“当前网页总结”不应该重新做正文抽取、摘要生成、缓存表。

### 5. 旧的页内文章视图已经不再是主方向

当前主分支已经新增：

- `src/entrypoints/sidepanel/*`
- `src/entrypoints/background/sidepanel.ts`

同时删掉了旧的：

- `src/entrypoints/side.content/components/side-content/index.tsx`

这说明页面级能力的新宿主更适合放在浏览器 `sidepanel`，而不是把新的网页总结 UI 再塞回旧的页内面板思路。

## 划词 AI 解释应该怎么接

### 推荐方案

做成 selection toolbar 的内置 Explain 按钮，并补一个右键入口。  
但执行层不要新开一套 Explain 专线，而是复用现有 custom action 执行框架。

可以把它理解成：

- UI 上它是“内置功能”
- 执行上它是“固定模板的内置 custom action”

### 为什么不建议新做一套

如果单独再做一套 Explain provider、stream、result state，会重复已有的：

- provider 选择
- LLM structured output
- thinking / abort / rerun
- popover 锚点和重开逻辑
- context menu 到 selection session 的恢复

这些都已经在 `custom-action-button` 这套代码里做过了。

### 建议的结果结构

Explain 结果建议继续走结构化输出，至少包含这些字段：

- `summary`: 对选中内容的一句话说明
- `translation`: 目标语言直译或意译
- `explanation`: 面向用户的主解释
- `keyPoints`: 关键点数组
- `terms`: 术语数组，每项包含 `term`、`meaning`、`notes`

如果只做 v1，最小可用字段可以先收缩成：

- `summary`
- `translation`
- `explanation`

这样可以先接通内置能力，再按需要补 `terms` 和更细的结构。

### 未来实现最小改动范围

后续真做时，优先改这些位置：

- `src/types/config/config.ts`
  - 新增 `selectionToolbar.features.explain`
- `src/utils/constants/config.ts`
  - 给 explain 补默认配置
- `src/utils/message.ts`
  - 新增 `openSelectionExplainFromContextMenu`
- `src/entrypoints/background/context-menu.ts`
  - 新增 explain 的 selection menu item
- `src/entrypoints/selection.content/selection-toolbar/index.tsx`
  - 在 built-in buttons 里插入 `ExplainButton`
- `src/entrypoints/selection.content/selection-toolbar/explain-button/*`
  - 做内置 Explain 的 UI 包装层
- `src/entrypoints/selection.content/selection-toolbar/custom-action-button/use-custom-action-execution.ts`
  - 直接复用，不建议重写

## 当前网页总结应该怎么接

### 推荐方案

“当前网页总结”做成页面级入口，优先放进 `sidepanel`。  
它的执行顺序应是：

1. 读取 `webPageContext`
2. 如果已有缓存摘要，直接复用
3. 如果没有缓存摘要，调用 `getOrGenerateWebPageSummary`
4. 在 `sidepanel` 展示 summary，并允许后续扩展成更完整的网页分析卡片

### 为什么不建议塞进 selection toolbar

selection toolbar 的模型是“围绕当前选区做一次短动作”。  
网页总结的模型是“围绕整页做一次页面级动作”。

两者的输入粒度、交互时机、结果尺寸都不一样：

- selection toolbar 适合短结果、就地弹出
- 网页总结更适合较长结果、可继续追问、可保留上下文

`sidepanel` 正好更适合第二种。

### 为什么推荐 `sidepanel`

当前仓库已经把新的页面级 AI UI 重心放到 `sidepanel`：

- `src/entrypoints/sidepanel/app.tsx`
- `src/entrypoints/sidepanel/components/chat-workspace.tsx`
- `src/entrypoints/background/sidepanel.ts`

如果网页总结也落在 sidepanel，有两个直接好处：

- 不用重新造一个页面级容器
- 后续可以自然扩展成“总结后继续提问当前网页”的体验

### 对现有摘要链路的结论

`getOrGenerateWebPageSummary` 应直接复用。  
不建议为了“网页总结”再新增一个后台摘要接口。

理由：

- 现有 message 协议已经独立
- background 已经做了缓存和并发去重
- `webTitle + webContent + providerConfig` 已经是现成输入

如果后续需要比“2-3 句摘要”更长的结果，应新增“网页分析”这一级能力，而不是重做“网页摘要”。

## 方案对比

### 方案 1：内置 Explain，执行层复用 custom action

优点：

- UI 清晰，用户能直接看到 Explain
- 复用现有 structured output 和 streaming
- 改动范围小
- 右键入口可以和工具栏入口共享同一条执行链

缺点：

- 要在 built-in feature 和 custom action 之间补一层包装

结论：推荐。

### 方案 2：只提供 Explain 模板，继续完全依赖 custom action

优点：

- 代码改动最少
- 不需要新增 built-in feature 配置

缺点：

- 对用户不够直接
- 首次使用前需要先配动作
- README 里说的“Explain”会变成隐式能力

结论：可作为过渡方案，但不适合默认产品体验。

### 方案 3：单独再做一套 Explain / Summary 专用流水线

优点：

- 可以完全按产品需求定制状态和结果

缺点：

- 大量重复已有逻辑
- provider、stream、abort、result schema、context menu session 恢复都会再做一遍
- 后期维护更重

结论：不推荐。

## 未来接口结论

后续实现时，建议把这些接口直接定下来：

- `selectionToolbar.features.explain`
- `read-frog-selection-explain`
- `openSelectionExplainFromContextMenu`

Explain 结果继续走 structured output。  
v1 最小字段：

- `summary`
- `translation`
- `explanation`

网页总结继续复用：

- `getOrGenerateWebPageSummary`

不新增：

- 专用后台“网页摘要” message
- 新的摘要缓存表
- 新的网页正文提取流程

## 最小实施顺序

如果后面真的要做，建议顺序是：

1. 给 selection toolbar 增加 `explain` feature 配置和默认值
2. 增加 explain 的右键菜单项和 message
3. 做 `ExplainButton`，内部复用 custom action 执行链
4. 先让 Explain 输出最小三字段结构
5. 在 sidepanel 加一个“总结当前网页”入口
6. sidepanel 直接消费 `webPageContext + getOrGenerateWebPageSummary`
7. 如果需要更长内容，再扩展成“网页分析”，不要污染摘要接口

## 额外说明

仓库里还有这些和“网页分析”相关的类型或 prompt：

- `src/types/content.ts`
  - `articleAnalysisSchema`
  - `articleExplanationSchema`
- `src/utils/prompts/analyze.ts`
- `src/utils/prompts/explain.ts`

从当前代码引用看，这些更像历史沉淀或待接回能力，并不是主干运行链路的一部分。  
因此它们可以作为输出结构和 prompt 设计的参考，但不建议直接把未来实现绑回一条全新的“article analyze runtime”。
