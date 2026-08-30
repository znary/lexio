# LLM 网关环境变量配置 / 换服务商指南

> 面向 AI 的说明文档。**所有模型服务商相关的 base URL、API Key、模型名、请求附加字段，都在 `apps/platform-api` 这个 Cloudflare Worker 里通过环境变量配置，不改代码即可切换。**
>
> 阅读本文件可快速理解：worker 怎么转发 LLM 请求、改哪些环境变量、有哪些坑（尤其 1101）。

---

## 1. 一次说清：这个 Worker 是"OpenAI 兼容网关"

- Worker 位置：`apps/platform-api`（`name: lexio-platform-api`，线上 `https://lexio-platform-api.lznwpu.workers.dev`）。
- 核心转发函数：`apps/platform-api/src/lib/ai.ts` 的 `forwardChatCompletions(env, body, plan, signal)`。
- 它把收到的请求体**原样转发**到 `POST ${LLM_BASE_URL}/chat/completions`（OpenAI Chat Completions 协议），并**原样透传**上游的 Response（成功时直接返回，流式则透传 SSE）。
- 认证头：同时设置 `Authorization: Bearer <LLM_API_KEY>` 与 `x-api-key: <LLM_API_KEY>`（兼容两类服务商）。
- 会剥离客户端传入的 `model` 字段，上游模型一律用环境变量 `LLM_MODEL`（平台说了算，client 不指定）。

## 2. 谁调用了 `forwardChatCompletions`（即：谁走这个网关）

| 扩展/平台入口 | 路径 | 说明 |
|---|---|---|
| 托管文本翻译 | `POST /v1/translate` | 扩展 `translateWithManagedPlatform()` → 视口/批次翻译。body = `{ messages:[{role:system},{role:user}], temperature, stream }`。 |
| 托管 LLM chat / 结构化输出 | `POST /v1/llm/chat/completions`、`POST /v1/openai/chat/completions` | 扩展 `getModelById()` 创建的 OpenAI-compatible model（`baseURL = PLATFORM_LLM_BASE_URL = .../v1/llm`），包括划词词典、自定义 action 的 structured output。 |
| 生词例句/本地回填 | `src/lib/db.ts` | 词库上下文句子等，同样走 `forwardChatCompletions`。 |

即：**翻译、chat、结构化输出、例句生成，全部统一的这个 LLM 网关**。

## 3. 环境变量（全部可选名 + 生效方式）

在 `apps/platform-api/wrangler.jsonc` 的 `vars` 里配置，或用 `wrangler secret put` 传敏感值。

| 变量 | 必填 | 默认 | 作用 |
|---|---|---|---|
| `LLM_BASE_URL` | 是 | 无（缺则报 `500 LLM_BASE_URL is not configured`） | OpenAI 兼容 API 根地址（不含 `/chat/completions`），如 `https://api.b.ai/v1`、`https://api.openai.com/v1`。 |
| `LLM_API_KEY` | 是 | 无 | 上游 API Key。用 `npx wrangler secret put LLM_API_KEY` 设置，**不要写进 wrangler.jsonc**。 |
| `LLM_MODEL` | 是 | 无 | 模型 ID，如 `deepseek-v4-flash`、`gemini-3.6-flash`、`gpt-5.4-nano`。 |
| `LLM_EXTRA_BODY` | 否 | `{}` | JSON，**合并进请求体**，用于服务商特有字段（见 §5）。 |
| `LLM_MAX_RETRIES` | 否 | `4` | 对 `429/500/502/503` 的指数退避重试次数（基础 300ms × 2^n + 抖动，尊重 AbortSignal）。 |
| `MANAGED_TRANSLATION_ENGINE` | 否 | `managed-llm` | `/v1/translate` 使用的引擎路由标签：`managed-llm`（走 LLM 网关）或 `cf-workers-ai`（Cloudflare Workers AI `@cf/meta/m2m100-1.2b`）。 |

> 相关绑定：`AI`（Workers AI binding，仅在 `cf-workers-ai` 引擎用）；`WORKERS_AI_TRANSLATION_MODEL`（Workers AI 模型名，默认 `@cf/meta/m2m100-1.2b`）。

## 4. 当前提交的配置（B.AI）

`apps/platform-api/wrangler.jsonc` 目前写死指向 B.AI（这是"默认演示"，随时可改）：

```jsonc
"MANAGED_TRANSLATION_ENGINE": "managed-llm",
"LLM_BASE_URL": "https://api.b.ai/v1",
"LLM_MODEL": "deepseek-v4-flash",
"LLM_EXTRA_BODY": "{\"thinking\":{\"type\":\"disabled\"}}",
"LLM_MAX_RETRIES": "4"
```

## 5. 服务商特有字段之"关闭思考"（关键坑）

- DeepSeek 系列默认会**思考**，很慢。B.AI 上必须用 `thinking: { "type": "disabled" }` 关闭。
- **B.AI 不接受** `reasoning_effort: "none"`（合法是 low/medium/high/xhigh/max，none 直接 400）；也**不接受** `thinking: false`（布尔，400 invalid json）。
- 因此通过 `LLM_EXTRA_BODY` 注入：`LLM_EXTRA_BODY={"thinking":{"type":"disabled"}}`。（实测 reasoning_tokens=0，速度明显提升。）
- 换了不用关思考的服务商（如普通 OpenAI/gemini），把该项删掉或置空即可。

**为什么不用 AI SDK（`@ai-sdk/openai`）？**
`@ai-sdk/openai` 只透传类型化的 `providerOptions.openai.*`，无法携带 B.AI 这类**非标准字段** `thinking`（会丢字段或 schema 校验失败），而 B.AI 又拒绝 OpenAI 标准的 `reasoning_effort:"none"`。所以这里保留了**通用 OpenAI 兼容 HTTP 转发层**（与官方 OpenAI 兼容协议同构），能兼顾"流式透传 + 服务商特殊字段"。切到不需要特殊字段的服务商时，可评估改回 AI SDK。

## 6. 两种引擎的选择

| 引擎 | 适用 | 说明 |
|---|---|---|
| `managed-llm`（默认） | 想用外部/自研 OpenAI 兼容服务（B.AI、DeepSeek、OpenAI、Gemini、国内平台等） | 走 §3 的 `LLM_*` 环境变量，最灵活。 |
| `cf-workers-ai` | 想用 Cloudflare 自有 Workers AI（免费额度、无需外部 key） | 用 `AI` binding + `WORKERS_AI_TRANSLATION_MODEL`，模型 `@cf/meta/m2m100-1.2b`。额度 10k Neuron/天。 |

## 7. 如何换服务商（只改环境变量）

```bash
# 1. 改 apps/platform-api/wrangler.jsonc 的 vars（或 Cloudflare 面板的环境变量）
#    LLM_BASE_URL / LLM_MODEL / LLM_EXTRA_BODY / LLM_MAX_RETRIES

# 2. 设置 API Key（secret，不进仓库）
cd apps/platform-api
npx wrangler secret put LLM_API_KEY

# 3. 部署
npx wrangler deploy

# 4. 验证
curl -s https://lexio-platform-api.lznwpu.workers.dev/health | jq .envDiagnostics
# 期望 llmBaseUrl.configured=true, llmApiKey=true, llmModelConfigured=true, warnings=[]
```

本地联调：把对应变量写进 `apps/platform-api/.dev.vars`（已被 `.gitignore` 忽略）再 `npx wrangler dev`。

## 8. 必须知道的两个 1101 坑（重要）

1101 = "Worker threw exception"。**改代码时绝不要踩这两条**：

1. **不要做跨请求的并发信号量/限流**。
   Cloudflare Workers 每个请求是独立上下文。如果请求 A 的 `finally` 去 resolve 请求 B 等待的 Promise，会被判为"挂起"而**取消请求 → 1101**。并发/限流应放客户端（扩展的 RequestQueue，`maxConcurrency` 见 `src/entrypoints/background/translation-queues.ts` 的 `MANAGED_TRANSLATION_MAX_CONCURRENCY`，当前 `4`）。

2. **`index.ts` 里每个路由必须 `return await handleX(...)`**。
   `async` 函数里 `return handleX(...)`（漏 `await`）时，若该 handler reject，rejection 不会被外层 `try/catch` 捕获 → **1101**。当前 `apps/platform-api/src/index.ts` 已全部 `await`，改动了路由务必保持。

## 9. 相关站点/其余说明

- 扩展端路由无需改：托管 provider 固定指向平台 `/v1/translate`（文本）与 `/v1/llm`（结构化）。
- worker 中 429/5xx 的退避重试在 `forwardChatCompletions` 内完成（§3 的 `LLM_MAX_RETRIES`）。
- 页面"正文优先"翻译（正文先译、目录/导航延后）是扩展内容脚本逻辑，见
  `src/entrypoints/host.content/translation-control/page-translation.ts` 的 `computeTranslationPriorityDelayMs`，与本文的 LLM 网关无关。
