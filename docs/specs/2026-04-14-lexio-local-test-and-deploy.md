# Lexio 本地测试和部署说明

这份文档只写当前代码已经实现的内容，方便下一步本地联调和正式上线。

## 已实际验证的结果

2026-04-14 我已经实际跑过下面这些命令：

```bash
pnpm type-check
pnpm --dir apps/platform-api type-check
pnpm --dir apps/platform-web type-check
pnpm --dir apps/platform-web build
SKIP_FREE_API=true pnpm test
pnpm --dir apps/platform-api d1:migrate:local
pnpm --dir apps/platform-api exec wrangler whoami
pnpm --dir apps/platform-api exec wrangler d1 create lexio-platform-dev
pnpm --dir apps/platform-api exec wrangler d1 migrations apply lexio-platform-dev --remote --env dev
pnpm --dir apps/platform-api deploy:dev
curl https://lexio-platform-api-dev.lznwpu.workers.dev/health
pnpm --dir apps/platform-api exec wrangler d1 execute lexio-platform-dev --remote --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
```

当前确认结果：

- Cloudflare 账号已经登录，account id 是 `792e7704e9ce27ebda11e3fc5625cb56`
- 已创建免费测试 D1：`lexio-platform-dev`
- 这个测试库的 `database_id` 是 `56e9c056-d4bc-4b4f-a73f-1adf9629027a`
- 已部署免费测试 Worker：`lexio-platform-api-dev`
- 测试地址是 `https://lexio-platform-api-dev.lznwpu.workers.dev/health`
- 远端 `/health` 已返回 200
- 远端 D1 表结构已经落库，`users`、`subscriptions`、`entitlements`、`sync_state`、`usage_ledger`、`user_settings`、`vocabulary_items` 都查到了
- 当前工作区里还没有 `.env.local`、`apps/platform-api/.dev.vars`、`apps/platform-web/.env.local`
- 所以这次真实测试只覆盖了 Cloudflare Worker、D1、Durable Object 绑定和健康检查，没有继续做 Clerk、Paddle、AI Gateway 的真请求
- 当前官网产物是 `wrangler deploy --config dist/wrangler.json` 这类 Worker 资产部署，不是现成的 Pages 项目

## 1. 先说两个和原方案不一样的地方

- Worker 现在读取的是 `CLERK_JWT_KEY`，不是方案文档里的 `CLERK_JWT_TEMPLATE`。
- 官网价格页现在还需要 `VITE_PADDLE_PRO_PRICE_ID`，不配这个值时，点击结账只会弹出缺少环境变量的提示。

## 2. 本地联调前要准备什么

- 一个可用的 Clerk 应用
- 一个可用的 Paddle sandbox 环境
- 一个 Cloudflare 账号
- Node.js 22+
- `pnpm`

如果你要完整验证 Paddle webhook，本地还需要一个能把 `http://127.0.0.1:8787` 暴露成公网 `https` 地址的 tunnel。没有 tunnel，可以先跳过 webhook 这一段。

## 3. 本地环境变量怎么放

先说明当前状态：

- 这三个文件现在都还不存在，所以你如果要继续联调，得先自己补上
- 下面这三段内容是模板，不是仓库里已经存在的真实值

### 3.1 扩展根目录 `.env.local`

```dotenv
WXT_PLATFORM_API_URL=http://127.0.0.1:8787
WXT_WEBSITE_URL=http://127.0.0.1:3355
```

注意：

- `WXT_WEBSITE_URL` 必须和你实际打开的网站 origin 完全一致。
- 不要一会儿用 `localhost`，一会儿用 `127.0.0.1`。这里现在做的是严格 origin 校验，混用会导致官网无法把 token 发回扩展。

### 3.2 `apps/platform-api/.dev.vars`

```dotenv
CLERK_SECRET_KEY=sk_test_xxx
CLERK_PUBLISHABLE_KEY=pk_test_xxx
CLERK_JWT_KEY=-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----
CLERK_AUDIENCE=
CLERK_AUTHORIZED_PARTIES=http://127.0.0.1:3355

AI_GATEWAY_BASE_URL=https://your-ai-gateway.example.com
AI_GATEWAY_API_KEY=sk_xxx
AI_GATEWAY_MODEL_FREE=openai/gpt-4.1-nano
AI_GATEWAY_MODEL_PRO=openai/gpt-4.1-mini

PADDLE_WEBHOOK_SECRET=whsec_xxx
PADDLE_API_KEY=pdl_xxx
PADDLE_ENV=sandbox
PADDLE_PRO_PRICE_ID=pri_xxx
```

说明：

- `CLERK_AUDIENCE` 和 `CLERK_AUTHORIZED_PARTIES` 要按你的 Clerk 配置来填；如果你没单独配 audience，可以先留空。
- `PADDLE_WEBHOOK_SECRET` 现在必须配置。没配时，Worker 会直接返回 500，这样能避免把未签名 webhook 当成真请求。

### 3.3 `apps/platform-web/.env.local`

```dotenv
VITE_CLERK_PUBLISHABLE_KEY=pk_test_xxx
VITE_PLATFORM_API_URL=http://127.0.0.1:8787
VITE_PADDLE_CLIENT_TOKEN=test_xxx
VITE_PADDLE_ENV=sandbox
VITE_PADDLE_PRO_PRICE_ID=pri_xxx
VITE_EXTENSION_ID=
```

说明：

- `VITE_EXTENSION_ID` 可以先留空。正常流程是从扩展里点 `Sign in`，官网会自动带上 `?extensionId=...`。
- 如果你想直接手输网址测试 `/extension-sync` 页面，再把扩展 ID 补进去。

## 4. 第一次本地启动

### 4.1 安装依赖

```bash
pnpm install
```

### 4.2 初始化本地 D1

先确认 `apps/platform-api/wrangler.jsonc` 已经存在数据库配置，然后执行：

```bash
pnpm --dir apps/platform-api d1:migrate:local
```

如果你想直接看底层命令，对应的是：

```bash
pnpm --dir apps/platform-api exec wrangler d1 migrations apply lexio-platform --local
```

### 4.3 启动 Worker API

```bash
pnpm --dir apps/platform-api dev
```

默认地址是：

```text
http://127.0.0.1:8787
```

先用这个命令确认健康检查：

```bash
curl http://127.0.0.1:8787/health
```

这一步我已经用 `wrangler dev` 真跑过一次，本地 `/health` 是通的。

### 4.4 启动官网

```bash
pnpm --dir apps/platform-web dev
```

默认地址是：

```text
http://127.0.0.1:3355
```

### 4.5 启动扩展

另开一个终端：

```bash
pnpm dev
```

然后在浏览器扩展管理页加载开发产物。

本地联调时最重要的是这两个地址要对上：

- 扩展里的 `WXT_WEBSITE_URL`
- 你实际打开官网时的 origin

## 5. 我建议先跑一遍自动验证

这些命令我已经在当前代码上跑过，结果是通过：

```bash
pnpm type-check
pnpm --dir apps/platform-api type-check
pnpm --dir apps/platform-web type-check
pnpm --dir apps/platform-web build
SKIP_FREE_API=true pnpm test
pnpm --dir apps/platform-api d1:migrate:local
```

说明：

- `SKIP_FREE_API=true` 是必须的，因为仓库里有一组依赖外部翻译服务的测试。
- 如果你只改了官网或 Worker，也建议把上面四条都跑完，省得改动互相影响。

## 6. 本地手工验收顺序

### 6.1 验证官网四个页面

依次打开：

- `/sign-in`
- `/pricing`
- `/checkout-success`
- `/extension-sync`

你要确认：

- 页面都能打开
- Clerk 组件能正常渲染
- `/pricing` 点击按钮时不会因为前端环境变量缺失直接报错

### 6.2 验证官网把 token 发回扩展

1. 在扩展设置页打开 `Account & Plan` 卡片。
2. 点击 `Sign in`。
3. 确认新标签页打开的是：

```text
http://127.0.0.1:3355/extension-sync?extensionId=你的扩展ID
```

4. 在官网完成登录。
5. 回到 `/extension-sync` 页面，确认页面状态变成 `Extension synced`。
6. 回到扩展设置页，确认：
   - 账号邮箱能显示出来
   - `Not signed in` 变成 `Signed in`

如果这里失败，先看这三件事：

- 官网 origin 和 `WXT_WEBSITE_URL` 是否完全一致
- 扩展是否重新构建过
- 当前浏览器 profile 里装的是不是这次本地跑起来的扩展

### 6.3 验证 `/v1/me`

在扩展完成登录后，扩展设置页应该会自动拉一次账号信息。你要确认：

- 套餐能显示 `Free` 或 `Pro`
- `Sync status` 有值
- 没有出现 “Platform session expired” 之类的错误

### 6.4 验证同步

在扩展里做两件事：

1. 改一项设置
2. 新增一个词汇项

然后点 `Sync now`，确认：

- 没有报错
- 设置页出现成功提示
- 再次点 `Sync now` 不会把本地数据冲掉

如果你要验证拉取逻辑，可以：

1. 先完成一次同步
2. 手动改 D1 里的 `user_settings` 或 `vocabulary_items`
3. 再点一次 `Sync now`
4. 确认扩展能拿到云端新数据

### 6.5 验证托管模型请求

登录完成后，在扩展里触发一次需要走托管模型的功能，例如：

- 选择工具栏翻译
- 字幕翻译
- 其他走 `managed-cloud-default` 的功能

你要确认：

- 请求能成功到 Worker
- Worker 能转发到 AI Gateway
- 超过配额时会收到明确错误，不会静默失败

### 6.6 验证 Paddle 结账

本地先用 sandbox：

1. 打开 `/pricing`
2. 登录 Clerk
3. 点击 `Upgrade to Pro`
4. 确认 Paddle overlay 能打开

如果你只验证到这一步，说明前端结账已经接通。

### 6.7 验证 Paddle webhook

这一段必须有公网 `https` 地址。

做法：

1. 用 tunnel 把本地 Worker 暴露出去。
2. 在 Paddle sandbox 后台把 webhook 指到：

```text
https://你的公网地址/webhooks/paddle
```

3. 用 sandbox 结账完成一次订阅。
4. 再回扩展设置页或直接请求 `/v1/me`，确认套餐已经从 `Free` 变成 `Pro`。

如果 webhook 收到了，但套餐没变化，优先检查：

- `PADDLE_WEBHOOK_SECRET`
- `PADDLE_PRO_PRICE_ID`
- Paddle `customData.clerkUserId`

## 7. 正式部署前要先补齐的配置

### 7.1 Cloudflare D1

现在仓库里已经多了一套单独的 Cloudflare 测试环境：

- `wrangler.jsonc` 顶层默认配置还是正式环境占位值
- `wrangler.jsonc` 里新增了 `env.dev`
- `env.dev` 绑定的 Worker 名字是 `lexio-platform-api-dev`
- `env.dev` 绑定的 D1 名字是 `lexio-platform-dev`
- 这个 dev 环境已经完成远端迁移和远端 `/health` 验证

如果你只是继续复用我这次建好的免费测试环境，不需要再创建一次 D1。

第一次上线前先创建正式数据库：

```bash
pnpm --dir apps/platform-api exec wrangler d1 create lexio-platform
```

然后把返回的真实 `database_id` 写回 [apps/platform-api/wrangler.jsonc](/Users/liuzhuangm4/develop/english/apps/platform-api/wrangler.jsonc)。

注意：

- 不要把 `lexio-platform-dev` 的 `database_id` 覆盖到顶层默认配置
- 顶层默认配置还是给正式环境留的
- 现在这次已经创建好的测试库 ID 是 `56e9c056-d4bc-4b4f-a73f-1adf9629027a`

### 7.2 Worker 正式变量和密钥

至少要配这些值：

- `CLERK_SECRET_KEY`
- `CLERK_PUBLISHABLE_KEY`
- `CLERK_JWT_KEY`
- `CLERK_AUDIENCE`
- `CLERK_AUTHORIZED_PARTIES`
- `AI_GATEWAY_BASE_URL`
- `AI_GATEWAY_API_KEY`
- `AI_GATEWAY_MODEL_FREE`
- `AI_GATEWAY_MODEL_PRO`
- `PADDLE_API_KEY`
- `PADDLE_WEBHOOK_SECRET`
- `PADDLE_ENV`
- `PADDLE_PRO_PRICE_ID`

敏感值建议用 `wrangler secret put`。

### 7.3 官网正式变量

官网至少要配：

- `VITE_CLERK_PUBLISHABLE_KEY`
- `VITE_PLATFORM_API_URL`
- `VITE_PADDLE_CLIENT_TOKEN`
- `VITE_PADDLE_ENV`
- `VITE_PADDLE_PRO_PRICE_ID`
- `VITE_EXTENSION_ID` 可选

### 7.4 扩展正式变量

扩展至少要配：

- `WXT_PLATFORM_API_URL`
- `WXT_WEBSITE_URL`

上线前一定确认：

- `WXT_WEBSITE_URL` 是正式官网 origin
- 正式官网 origin 已经在扩展包的 `externally_connectable.matches` 里

因为这个值是在构建扩展时写进去的，所以正式地址变了就必须重新打包扩展。

## 8. 正式部署顺序

### 8.1 先部署 Worker

如果你先复用已经建好的免费测试环境，直接跑：

```bash
pnpm --dir apps/platform-api d1:migrate:dev
pnpm --dir apps/platform-api deploy:dev
curl https://lexio-platform-api-dev.lznwpu.workers.dev/health
```

这套命令对应的就是：

- 远端 D1：`lexio-platform-dev`
- 远端 Worker：`lexio-platform-api-dev`
- 远端健康检查地址：`https://lexio-platform-api-dev.lznwpu.workers.dev/health`

如果你是第一次正式上线，不要直接用上面这个 dev 地址，继续看下面正式命令。

先跑正式迁移：

```bash
pnpm --dir apps/platform-api exec wrangler d1 migrations apply lexio-platform --remote
```

再部署：

```bash
pnpm --dir apps/platform-api deploy
```

部署后先测：

```bash
curl https://你的-api-域名/health
```

### 8.2 再部署官网

先构建：

```bash
pnpm --dir apps/platform-web build
```

当前仓库里官网构建后会生成 `dist/wrangler.json`。按现在这套产物，部署时要用这个配置文件。

这里要注意一件事：

- 这套产物现在是 Worker 资产部署，不是 Pages
- 如果你后面真想改成 Pages，要额外补 Pages 项目和部署方式
- 我这次没有直接部署官网，因为仓库里还没有 `VITE_CLERK_PUBLISHABLE_KEY` 这些真实值，页面会在启动时直接报错

如果你的环境里已经能直接用 `wrangler`，可以在 `apps/platform-web` 目录执行：

```bash
wrangler deploy --config dist/wrangler.json
```

如果你们后面想把这一步固定下来，建议再补一个 `apps/platform-web` 的正式 `deploy` 脚本。

### 8.3 最后打包扩展

正式打包前先确认扩展变量已经切到生产地址，然后执行：

```bash
pnpm build
pnpm zip
```

如果还要出 Edge 或 Firefox，再执行：

```bash
pnpm zip:edge
pnpm zip:firefox
```

## 9. 正式环境冒烟检查

按这个顺序检查最省时间：

1. 打开官网 `/sign-in`，确认能登录
2. 打开 `/pricing`，确认结账弹窗能打开
3. 完成一笔 sandbox 或正式订阅，确认 webhook 能把套餐写进数据库
4. 在扩展里点 `Sign in`
5. 确认 `/extension-sync` 页面显示 `Extension synced`
6. 回扩展设置页，确认 `Account & Plan` 正常显示
7. 点 `Sync now`，确认同步成功
8. 触发一次托管模型请求，确认 Worker 和 AI Gateway 都正常

## 10. 最容易卡住的点

- 官网和扩展必须是同一个 origin 约定，不能混用 `localhost` 和 `127.0.0.1`
- `PADDLE_WEBHOOK_SECRET` 缺失时，webhook 会直接失败，这是故意保守处理
- `VITE_PADDLE_PRO_PRICE_ID` 没配时，价格页不会真的拉起结账
- `apps/platform-api/wrangler.jsonc` 顶层默认 `database_id` 现在还是占位值，上线前必须改成正式库的真实 ID
- `apps/platform-api/wrangler.jsonc` 里的 `env.dev` 已经是可用测试配置，但它不是正式环境
- 本地没有公网 `https` 地址时，Paddle webhook 这段没法做完整验收
- 当前工作区里没有 Clerk、Paddle、AI Gateway 的真实环境变量，所以这次还没法继续做登录、结账、订阅回写和托管模型真测
