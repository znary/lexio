# Current Translation Architecture

这份文档只描述当前仓库里已经生效的翻译架构。

先给结论：

- 插件已经适配新的统一翻译接口，真实翻译请求只走 `POST /v1/translate`。
- Web 没有直接发翻译请求。它现在只负责登录、定价、支付回跳、把网站登录态交给插件。
- 旧的服务端 task 架构已经删除：
  - 没有 `/v1/translate/tasks`
  - 没有 `/v1/translate/tasks/:id/stream`
  - 没有 `/cancel`
  - 没有 Durable Object
  - 没有 Cloudflare Queue
  - 没有 `translation_tasks` 表

## 1. 先回答“插件和 web 已经适配了吗”

### 插件

已经适配。

插件里现在所有走平台托管翻译的入口，最终都收敛到 `src/utils/platform/api.ts`：

- 普通同步翻译：`translateWithManagedPlatform(...)`
- 流式翻译：`streamManagedTranslation(...)`

这两个函数最终都请求同一个接口：

- `POST /v1/translate`

区别只在请求体里是否带 `stream: true`。

### Web

Web 也已经和新架构对齐，但它不是翻译客户端。

`apps/platform-web` 现在只做这几件事：

- 登录
- 定价页
- 支付成功页
- 扩展同步页

它不会直接调用 `/v1/translate`。真正调用平台翻译接口的是插件，不是 Web。

## 2. 总览

```mermaid
flowchart LR
  subgraph Web["platform-web"]
    W1["sign-in"]
    W2["pricing"]
    W3["checkout-success"]
    W4["extension-sync"]
  end

  subgraph Ext["Browser Extension"]
    C1["页面翻译 / 页面标题 / 输入框"]
    C2["字幕翻译"]
    C3["划词翻译"]
    C4["Translation Hub"]
    B1["Background 本地队列"]
    B2["平台 API 客户端"]
  end

  subgraph API["platform-api"]
    A1["POST /v1/translate"]
    A2["/v1/auth/extension-token"]
    A3["/v1/me / /v1/sync/* / /v1/vocabulary"]
  end

  U["AI Gateway / 上游模型"]
  D["D1<br/>用户、订阅、词库、同步、usage"]

  W4 -->|"chrome.runtime.sendMessage"| Ext
  Ext --> A2
  Ext --> A3

  C1 --> B1
  C2 --> B1
  C3 -->|"LLM provider"| B2
  C3 -->|"普通 provider"| B1
  C4 --> B2

  B1 --> B2
  B2 --> A1
  A1 --> U
  API --> D
```

## 3. 现在哪些入口在翻译

当前主要有 6 个翻译入口：

1. 网页沉浸式翻译
2. 页面标题翻译
3. 输入框翻译
4. 字幕翻译
5. 划词翻译
6. Translation Hub

这 6 个入口最后不是都走同一条本地链路，实际分成 3 类：

- 走插件 background 本地队列：
  - 网页沉浸式翻译
  - 页面标题翻译
  - 输入框翻译
  - 字幕翻译
  - 划词翻译里的“普通 provider”分支
- 直连平台 SSE：
  - 划词翻译里的 LLM provider 分支
- 直连平台 JSON：
  - Translation Hub

## 4. 统一平台接口长什么样

服务端只保留了一个翻译路由：

- `POST /v1/translate`

它支持两种模式：

- JSON 模式：不传 `stream: true`
- SSE 模式：传 `stream: true`

```mermaid
flowchart TD
  R["POST /v1/translate"] --> J["stream != true"]
  R --> S["stream == true"]
  J --> J1["返回 JSON: { text }"]
  S --> S1["返回 text/event-stream"]
  S1 --> S2["客户端边收边显示"]
```

服务端翻译处理现在很简单：

1. 校验请求体
2. 根据 `scene` 组装 feature 名
3. 直接调用上游 chat completions
4. 记录 usage
5. 返回 JSON 或转发 SSE

不再有服务端任务创建、服务端排队、服务端恢复、task stream attach 这些步骤。

## 5. 插件里的公共层

### 5.1 Background 本地队列还在

删掉的是服务端 task/queue，不是插件本地队列。

插件 background 里还保留两层本地控制：

- `RequestQueue`
- `BatchQueue`

位置：

- `src/entrypoints/background/translation-queues.ts`

它们的职责是：

- 控制插件本地并发
- 在本地把多段文本合批
- 做本地缓存命中
- 给页面上的 loading 状态发本地通知

当前全局托管翻译并发常量是：

- `MANAGED_TRANSLATION_MAX_CONCURRENCY = 100`

### 5.2 平台客户端

平台客户端在：

- `src/utils/platform/api.ts`

这里面现在有三件事最重要：

- `platformFetch`：统一带 token 请求平台
- `translateWithManagedPlatform`：普通同步翻译
- `streamManagedTranslation`：流式翻译

### 5.3 文本翻译公共入口

大多数页面文本会先经过：

- `src/utils/host/translate/translate-text.ts`

这里会做几件事：

1. 整理文本
2. 根据 prompt、语言、provider、上下文算 hash
3. 生成 `statusKey`
4. 通过消息发给 background

## 6. 网页沉浸式翻译

入口：

- `translateTextForPage`

文件：

- `src/utils/host/translate/translate-variants.ts`

这条链路会先做页面级预处理：

- 收集网页上下文
- 可选生成网页 summary
- 检查文本是否已经是目标语言
- 检查是否命中 skip language

然后再走 `translateTextCore -> enqueueTranslateRequest -> background`。

```mermaid
sequenceDiagram
  participant Page as 页面内容脚本
  participant Variants as translateTextForPage
  participant Core as translateTextCore
  participant BG as Background queue
  participant API as POST /v1/translate
  participant Upstream as 上游模型

  Page->>Variants: 逐段请求翻译
  Variants->>Variants: 读取网页上下文
  Variants->>Variants: 可选生成网页 summary
  Variants->>Variants: 目标语言 / skip language 预检查
  Variants->>Core: translateTextCore(...)
  Core->>Core: 计算 hash 和 statusKey
  Core->>BG: enqueueTranslateRequest
  BG->>BG: 查本地缓存
  BG->>BG: RequestQueue / BatchQueue
  BG->>API: POST /v1/translate
  API->>Upstream: forwardChatCompletions
  Upstream-->>API: 翻译结果
  API-->>BG: JSON { text }
  BG-->>Core: result
  Core-->>Page: 翻译文本
```

### 这一条链路的特点

- 可能先做网页上下文和 summary，首批请求会更重
- 如果 provider 是 LLM，background 会继续本地合批
- 如果 provider 不是 LLM，background 直接单条请求平台

## 7. 页面标题翻译

入口：

- `translateTextForPageTitle`

它和网页沉浸式翻译几乎一样，差别只有一个：

- 它强制把当前标题当作 `webTitle`

```mermaid
flowchart LR
  T["translateTextForPageTitle"] --> C["构造 webTitle = 当前标题"]
  C --> P["translateTextUsingPageConfig"]
  P --> Core["translateTextCore"]
  Core --> BG["Background queue"]
  BG --> API["POST /v1/translate"]
```

## 8. 输入框翻译

入口：

- `translateTextForInput`

文件：

- `src/utils/host/translate/translate-variants.ts`
- `src/entrypoints/selection.content/input-translation/use-input-translation.ts`

它和页面翻译的区别主要是语言方向：

- `fromLang`
- `toLang`

会先解析成最终的源语言和目标语言，再走 `translateTextCore`。

```mermaid
sequenceDiagram
  participant UI as 输入框 UI
  participant Input as translateTextForInput
  participant Core as translateTextCore
  participant BG as Background queue
  participant API as /v1/translate

  UI->>Input: text, fromLang, toLang
  Input->>Input: 解析 sourceCode / targetCode
  Input->>Input: 如果源语言和目标语言相同则直接返回
  Input->>Input: 读取网页上下文和 summary
  Input->>Core: translateTextCore(scene=input)
  Core->>BG: enqueueTranslateRequest
  BG->>API: POST /v1/translate
  API-->>BG: JSON { text }
  BG-->>UI: 翻译结果
```

## 9. 字幕翻译

入口：

- `TranslationCoordinator`
- `translateSubtitles`

文件：

- `src/entrypoints/subtitles.content/translation-coordinator.ts`
- `src/utils/subtitles/processor/translator.ts`

字幕翻译比页面翻译多一层“时间窗口挑片段”。

顺序是：

1. `TranslationCoordinator` 根据当前播放时间，挑附近的未翻译字幕
2. 一次最多取 `TRANSLATION_BATCH_SIZE`
3. `translateSubtitles` 对每条字幕分别发 `enqueueSubtitlesTranslateRequest`
4. background 再按 provider 和语言做本地合批

```mermaid
sequenceDiagram
  participant Video as TranslationCoordinator
  participant Translator as translateSubtitles
  participant BG as Background queue
  participant API as /v1/translate
  participant Upstream as 上游模型

  Video->>Video: 读取当前时间附近字幕
  Video->>Video: 取最多 N 条未翻译片段
  Video->>Translator: translateSubtitles(fragments)
  loop 每条字幕
    Translator->>BG: enqueueSubtitlesTranslateRequest
  end
  BG->>BG: 查缓存 / 本地合批
  BG->>API: POST /v1/translate
  API->>Upstream: 调模型
  Upstream-->>API: 结果
  API-->>BG: JSON { text }
  BG-->>Translator: 每条字幕的结果
  Translator-->>Video: 更新字幕显示
```

### 这条链路的特点

- 字幕先按播放时间挑片段
- 之后仍然复用 background 的本地队列和本地合批
- 如果所有字幕都失败，会抛出更友好的错误消息

## 10. 划词翻译

划词翻译有两条分支。

### 10.1 LLM provider：直连 SSE

入口：

- `translateWithLlm`

文件：

- `src/entrypoints/selection.content/selection-toolbar/translate-button/provider.tsx`

这条分支不走 background 队列，直接从内容脚本请求平台 SSE。

```mermaid
sequenceDiagram
  participant UI as 划词弹窗
  participant Provider as translateWithLlm
  participant Client as streamManagedTranslation
  participant API as POST /v1/translate(stream=true)
  participant Upstream as 上游模型

  UI->>Provider: 选择 LLM provider
  Provider->>Provider: 准备网页上下文和 summary
  Provider->>Provider: 生成 systemPrompt / prompt
  Provider->>Client: streamManagedTranslation(...)
  Client->>API: POST /v1/translate + stream=true
  API->>Upstream: 流式调用模型
  Upstream-->>API: chunk
  API-->>Client: SSE
  Client-->>UI: onChunk 边到边显示
```

这条链路的特点：

- 直接流式显示
- 没有 background 本地队列
- 没有本地合批
- 只有本地 abort，没有服务端 task cancel

### 10.2 普通 provider：走 background 队列

入口：

- `translateWithStandardProvider`

它会走：

- `translateTextCore`
- `enqueueTranslateRequest`
- background 本地队列
- `/v1/translate`

```mermaid
flowchart LR
  A["划词弹窗"] --> B["translateWithStandardProvider"]
  B --> C["translateTextCore"]
  C --> D["enqueueTranslateRequest"]
  D --> E["Background queue"]
  E --> F["POST /v1/translate"]
  F --> G["返回 JSON 文本"]
```

## 11. Translation Hub

入口：

- `TranslationCard`
- `executeTranslate`

文件：

- `src/entrypoints/translation-hub/components/translation-card.tsx`
- `src/utils/host/translate/execute-translate.ts`

Translation Hub 不走 background 队列。

它会直接：

1. 根据 provider 和语言生成 prompt
2. 调 `translateWithManagedPlatform`
3. 直接请求 `/v1/translate`

```mermaid
sequenceDiagram
  participant Hub as Translation Hub
  participant Exec as executeTranslate
  participant Client as translateWithManagedPlatform
  participant API as POST /v1/translate

  Hub->>Exec: executeTranslate(inputText, provider)
  Exec->>Exec: 生成 prompt
  Exec->>Client: translateWithManagedPlatform
  Client->>API: POST /v1/translate
  API-->>Client: JSON { text }
  Client-->>Hub: 结果
```

## 12. Web 到插件的认证桥接

这部分不是翻译链路，但它决定插件能不能调用平台 API，所以要单独写清楚。

Web 的主链路是：

1. 用户在 `platform-web` 登录
2. `extension-sync` 页面通过 `chrome.runtime.sendMessage` 把 Clerk token 发给插件
3. 插件 background 收到消息后，请求 `/v1/auth/extension-token`
4. 平台返回自己的 extension token
5. 插件把它存起来，后续所有 `/v1/translate`、`/v1/me`、`/v1/sync/*`、`/v1/vocabulary` 都带这个 token

```mermaid
sequenceDiagram
  participant Web as platform-web
  participant Ext as Extension Background
  participant API as platform-api

  Web->>Ext: lexio-platform-auth-sync(token)
  Ext->>API: POST /v1/auth/extension-token
  API-->>Ext: platform token
  Ext->>Ext: 保存 platform session
  Ext->>API: 后续所有平台请求都带 Authorization
```

### Web 现在负责什么

- `sign-in`
- `pricing`
- `checkout-success`
- `extension-sync`

### Web 现在不负责什么

- 不直接发翻译请求
- 不直接请求 `/v1/translate`
- 不参与插件的本地排队和合批

## 13. 现在哪些数据还在 D1

翻译 task 不在 D1 里了，但平台自己的业务数据还在。

当前仍然会落 D1 的主要是：

- 用户
- 订阅
- entitlement
- usage
- 同步状态
- 词库

翻译结果本身主要有两层存放：

- 插件本地缓存：`db.translationCache`
- 平台侧 usage 记录：`recordUsage(...)`

## 14. 新架构和旧架构的区别

```mermaid
flowchart TD
  Old["旧架构"] --> Old1["/v1/translate/tasks"]
  Old --> Old2["Durable Object"]
  Old --> Old3["Cloudflare Queue"]
  Old --> Old4["translation_tasks 表"]
  Old --> Old5["task stream / cancel / recover"]

  New["新架构"] --> New1["/v1/translate"]
  New --> New2["插件本地队列"]
  New --> New3["直接调用上游模型"]
  New --> New4["JSON 或 SSE"]
```

新的做法更简单：

- 服务端不再保存翻译任务状态
- 取消只靠客户端 `AbortController`
- 需要流式显示时，直接走 `/v1/translate` 的 SSE
- 需要普通结果时，直接走 `/v1/translate` 的 JSON
- 页面和字幕的“排队”只留在插件本地

## 15. 代码索引

最关键的文件是这些：

- 平台入口：`apps/platform-api/src/index.ts`
- 平台翻译路由：`apps/platform-api/src/routes/translate.ts`
- 插件平台客户端：`src/utils/platform/api.ts`
- background 本地队列：`src/entrypoints/background/translation-queues.ts`
- 文本翻译公共入口：`src/utils/host/translate/translate-text.ts`
- 页面 / 标题 / 输入框翻译：`src/utils/host/translate/translate-variants.ts`
- 划词翻译：`src/entrypoints/selection.content/selection-toolbar/translate-button/provider.tsx`
- 字幕翻译：`src/utils/subtitles/processor/translator.ts`
- 字幕调度：`src/entrypoints/subtitles.content/translation-coordinator.ts`
- Translation Hub：`src/utils/host/translate/execute-translate.ts`
- Web 认证桥接：`apps/platform-web/src/app/platform-auth.ts`
- 插件认证接收：`src/entrypoints/background/platform-auth.ts`

## 16. 一句话版本

现在的真实结构就是：

- Web 只负责账号和把登录态交给插件
- 插件负责所有翻译入口
- 页面和字幕走插件 background 本地队列
- 划词的 LLM 分支和 Translation Hub 直连 `/v1/translate`
- 服务端只做统一翻译转发，不再维护翻译 task
