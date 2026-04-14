# Lexio 托管登录、订阅和云端同步实现文档

## 1. 目标

- 新增一套独立于扩展现有逻辑的账号、订阅、同步和托管模型能力。
- 不兼容旧登录、旧 Google Drive 同步、旧 provider 配置。
- 官网前端和 Cloudflare 后端都放在当前仓库内。
- 官网设计固定使用 `getdesign` 的 `airbnb` 风格，不再单独设计一套视觉规范。

## 2. 目录结构

- `apps/platform-api`
  - Cloudflare Worker API
  - D1 迁移
  - Durable Object
- `apps/platform-web`
  - 官网前端
  - Clerk 登录
  - Paddle.js 价格页和结账
  - 扩展登录态同步页

## 3. 固定技术栈

- 登录：`Clerk`
- 后端：`Cloudflare Workers`
- 数据库：`D1`
- 配额控制：`Durable Objects`
- 模型转发：`AI Gateway`
- 官网：`React + Vite + @cloudflare/vite-plugin`
- 支付：`@paddle/paddle-js`
- 本地开发：
  - `wrangler dev`
  - `wrangler d1 migrations apply --local`
  - `pnpm --dir apps/platform-api dev`
  - `pnpm --dir apps/platform-web dev`

## 4. 官网前端范围

- 只实现四个页面：
  - `/sign-in`
  - `/pricing`
  - `/checkout-success`
  - `/extension-sync`
- 在 `apps/platform-web` 根目录执行：
  - `npx getdesign@latest add airbnb`
- 生成的 `DESIGN.md` 作为官网 UI 的唯一设计依据。
- `pricing` 页面必须使用 `Paddle.Initialize()` 和 `Paddle.Checkout.open()`。

## 5. Worker API 范围

### 5.1 对外接口

- `GET /health`
- `GET /v1/me`
- `POST /v1/ai/generate`
- `POST /v1/ai/stream`
- `POST /v1/openai/chat/completions`
- `POST /v1/sync/pull`
- `POST /v1/sync/push`
- `POST /webhooks/paddle`

### 5.2 鉴权

- Worker 使用 Clerk 后端 SDK 校验扩展或官网传来的 Bearer token。
- 官网登录后，在 `/extension-sync` 页面获取 Clerk token，并发送给扩展。
- 扩展本地保存 token，用它请求 `/v1/me`、`/v1/sync/*` 和托管模型接口。

### 5.3 模型路由

- 扩展只暴露一个托管 provider：`managed-cloud-default`
- Worker 内部按 `feature + plan` 选择真实模型。
- 托管模型默认分两层：
  - `free`：便宜模型
  - `pro`：更强模型

## 6. D1 表结构

- `users`
  - `id`
  - `clerk_user_id`
  - `email`
  - `name`
  - `avatar_url`
  - `created_at`
  - `updated_at`
- `subscriptions`
  - `id`
  - `user_id`
  - `paddle_subscription_id`
  - `plan`
  - `status`
  - `current_period_start`
  - `current_period_end`
  - `cancel_at_period_end`
  - `created_at`
  - `updated_at`
- `entitlements`
  - `user_id`
  - `plan`
  - `monthly_request_limit`
  - `monthly_token_limit`
  - `concurrent_request_limit`
  - `updated_at`
- `usage_ledger`
  - `id`
  - `user_id`
  - `feature`
  - `request_kind`
  - `request_count`
  - `input_tokens`
  - `output_tokens`
  - `created_at`
- `user_settings`
  - `user_id`
  - `settings_json`
  - `updated_at`
- `vocabulary_items`
  - `id`
  - `user_id`
  - `item_json`
  - `normalized_text`
  - `updated_at`
- `sync_state`
  - `user_id`
  - `last_push_at`
  - `last_pull_at`
  - `last_sync_status`
  - `updated_at`

## 7. Durable Object

- `UsageGate`
  - 按 `userId` 控制并发请求
  - 预检查当月额度
  - 请求成功后写入 `usage_ledger`
  - 拒绝超额请求

## 8. 扩展改造范围

- 删除普通用户可见的 API provider 配置入口。
- 删除 Google Drive 同步入口。
- 配置页新增 `Account & Plan` 卡片：
  - 登录状态
  - 套餐
  - 同步状态
  - `Sign in`
  - `Manage subscription`
  - `Sync now`
- 扩展本地不再允许输入 provider、API key、base URL、model。
- 所有托管模型能力统一通过 `managed-cloud-default` 请求 Worker。

## 9. 环境变量

### 9.1 扩展

- `WXT_PLATFORM_API_URL`
- `WXT_WEBSITE_URL`

### 9.2 platform-api

- `CLERK_SECRET_KEY`
- `CLERK_PUBLISHABLE_KEY`
- `CLERK_JWT_TEMPLATE`
- `AI_GATEWAY_BASE_URL`
- `AI_GATEWAY_API_KEY`
- `PADDLE_API_KEY`
- `PADDLE_WEBHOOK_SECRET`
- `PADDLE_ENV`

### 9.3 platform-web

- `VITE_CLERK_PUBLISHABLE_KEY`
- `VITE_PLATFORM_API_URL`
- `VITE_PADDLE_CLIENT_TOKEN`
- `VITE_PADDLE_ENV`
- `VITE_EXTENSION_ID`

## 10. 实现顺序

1. 写入本文件
2. 建 `apps/platform-api`
3. 建 `apps/platform-web`
4. 在 `apps/platform-web` 运行 `npx getdesign@latest add airbnb`
5. 完成 Clerk 登录和 Paddle.js 价格页
6. 完成 Worker API 和 D1
7. 改扩展接入
8. 跑本地验证

## 11. 验收

- `platform-api` 可以本地启动
- `platform-web` 可以本地启动
- `DESIGN.md` 已生成并被官网页面采用
- 官网可登录、可打开 Paddle 结账
- 扩展可同步 Clerk token
- 扩展登录后可直接调用托管模型
- 扩展配置页不再暴露 provider 和 Google Drive 同步入口
