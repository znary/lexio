# 发布和打包命令

这份文档只说明三件事：

- 发布 API
- 发布 Web
- 打包浏览器扩展

建议都在仓库根目录 `/Users/liuzhuangm4/develop/english` 执行。这样不用反复切目录。

## 前置条件

- 发布 API 或 Web 前，Wrangler 需要可用的 Cloudflare 登录态，或者已经设置 `CLOUDFLARE_API_TOKEN`
- 打包扩展前，至少要准备这三个环境变量：`WXT_GOOGLE_CLIENT_ID`、`WXT_POSTHOG_API_KEY`、`WXT_POSTHOG_HOST`

## 直接可用的命令

| 场景                  | 命令                             | 实际做的事                                         |
| --------------------- | -------------------------------- | -------------------------------------------------- |
| 启动 API 本地开发     | `pnpm dev:api`                   | 进入 `apps/platform-api` 跑 `wrangler dev`         |
| 启动 Web 本地开发     | `pnpm dev:web`                   | 进入 `apps/platform-web` 跑 `vite`                 |
| 同时启动 API 和 Web   | `pnpm dev:platform`              | 并行启动上面两个服务                               |
| 构建 Web              | `pnpm build:web`                 | 进入 `apps/platform-web` 跑 `vite build`           |
| 发布 API              | `pnpm deploy:api`                | 进入 `apps/platform-api` 跑 `wrangler deploy`      |
| 发布 Web              | `pnpm deploy:web`                | 先构建 `apps/platform-web`，再跑 `wrangler deploy` |
| 本地执行 D1 migration | `pnpm migrate:api:local`         | 进入 `apps/platform-api` 跑本地 D1 migration       |
| 远端执行 D1 migration | `pnpm migrate:api:remote`        | 进入 `apps/platform-api` 跑远端 D1 migration       |
| 打包 Chrome 扩展      | `pnpm package:extension`         | 生成 Chrome zip                                    |
| 打包 Edge 扩展        | `pnpm package:extension:edge`    | 生成 Edge zip                                      |
| 打包 Firefox 扩展     | `pnpm package:extension:firefox` | 生成 Firefox zip                                   |
| 一次打包全部扩展      | `pnpm package:extension:all`     | 顺序生成 Chrome / Edge / Firefox 三份 zip          |

## 最常用的三条命令

### 1. 发布 API

```bash
pnpm deploy:api
```

等价于：

```bash
cd apps/platform-api
pnpm run deploy
```

如果这次改动包含 D1 migration，先按需要执行：

```bash
pnpm migrate:api:local
pnpm migrate:api:remote
```

## 2. 发布 Web

```bash
pnpm deploy:web
```

等价于：

```bash
cd apps/platform-web
pnpm run deploy
```

这个命令已经包含构建步骤，不需要先手动跑一次 `build`。

## 3. 打包浏览器扩展

Chrome：

```bash
pnpm package:extension
```

Edge：

```bash
pnpm package:extension:edge
```

Firefox：

```bash
pnpm package:extension:firefox
```

全部一起打：

```bash
pnpm package:extension:all
```

产物会放在根目录的 `.output/` 下面。

## 现在不要再用的旧名字

- `pnpm dev:platform-api` 改成 `pnpm dev:api`
- `pnpm dev:platform-web` 改成 `pnpm dev:web`
- `pnpm zip*` 改成 `pnpm package:extension*`
- `apps/platform-web` 里的 `pnpm run deploy:cf` 改成 `pnpm run deploy`

## 一个容易误会的命令

根目录的 `pnpm release` 还在保留，但它只是给 Changesets 和 GitHub Actions 打 tag 用。

它不负责下面这些事：

- 不发布 API
- 不发布 Web
- 不打包扩展

如果你只是想上线 API / Web，或者导出扩展 zip，请直接用上面那几条明确的命令。
