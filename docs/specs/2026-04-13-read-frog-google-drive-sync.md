# Read Frog 二次开发规格文档（Google Drive 同步版）

## 1. 目标

- 基于 `Read Frog` fork 开发，不从零开始。
- 保留现有能力：翻译、AI、整页翻译、划词翻译。
- 首版新增四个能力：
  - 手动划词翻译后自动收藏
  - 原网页再次出现时自动高亮
  - 单词本管理
  - Google Drive 多端同步
- 不做自家后端。
- 不做官网账号系统。
- 官网只保留静态站内容：下载、文档、隐私、条款、更新说明。

## 2. 产品约束

- 扩展正常使用不依赖官网登录。
- 首版唯一登录行为是扩展内的 `Connect Google Drive`。
- 不保留 `Read Frog` 的 `Log in` 和 `Notebase` 产品入口。
- 自动收藏只发生在“用户手动划词翻译成功”之后。
- 收藏对象只允许：
  - 单词
  - 最多 `8` 个词的英文短句
- 高亮只作用于原网页文本。
- 不高亮扩展自己插入的译文、浮层、侧边栏、设置面板。
- 首版同步内容包含：
  - 扩展设置
  - provider 配置
  - 单词本数据
- 首版不同步：
  - 页面翻译缓存
  - 临时 UI 状态
  - 会话历史
  - 调试信息

## 3. 已实现的主要模块

### 3.1 词库模型

- 新增 `VocabularyItem`：
  - `id`
  - `sourceText`
  - `normalizedText`
  - `translatedText`
  - `sourceLang`
  - `targetLang`
  - `kind`
  - `wordCount`
  - `createdAt`
  - `lastSeenAt`
  - `hitCount`
  - `updatedAt`
  - `deletedAt`
- 新增 `VocabularySettings`：
  - `autoSave`
  - `highlightEnabled`
  - `maxPhraseWords`
  - `highlightColor`

### 3.2 本地存储

- 配置 schema 升级到 `v68`。
- 新增配置项 `config.vocabulary`。
- 新增本地存储键：
  - `vocabularyItems`
  - `lastSyncedVocabularyItems`
  - `googleDrivePendingSync`
  - `googleDriveSyncConflict`

### 3.3 自动收藏

- 在划词翻译成功后调用词库存储逻辑。
- 保存前执行：
  - 语言候选判断
  - 词数判断
  - 规范化
  - 去重
- 重复收藏时不新建记录，只更新：
  - `sourceText`
  - `translatedText`
  - `lastSeenAt`
  - `hitCount`
  - `updatedAt`
- 当词条曾被删除时，再次收藏会恢复该词条。

### 3.4 网页高亮

- 在 `selection.content` 中新增高亮钩子。
- 页面首次加载、DOM 变化、路由变化后刷新高亮。
- 通过 `mark.js` 高亮已收藏单词和短句。
- 默认排除：
  - 扩展注入节点
  - `input`
  - `textarea`
  - `select`
  - `code`
  - `pre`
  - `script`
  - `style`
  - `contenteditable`
- 点击高亮内容时，复用现有划词工具栏逻辑重新打开翻译浮层。

### 3.5 单词本界面

- 在设置页加入 `Vocabulary` 区块。
- 支持：
  - 开关自动收藏
  - 开关网页高亮
  - 设置短句最大词数
  - 设置高亮颜色
- 新增单词本列表卡片，支持：
  - 搜索
  - 删除
  - 清空
  - 导出 JSON

### 3.6 Google Drive 同步

- 继续使用 `Read Frog` 原有 Google Drive 授权方式。
- 远端同步文件名改成基于当前应用名生成，不再写死为 `read-frog`。
- 远端同步载荷固定为：
  - `schemaVersion`
  - `updatedAt`
  - `settings`
  - `providerConfig`
  - `vocabularyItems`
- 本地和远端同步行为：
  - 首次连接后立即拉取
  - 已授权时启动自动拉取
  - 配置或单词本变更后，`5` 秒防抖自动推送
  - 支持失败后告警重试

## 4. 同步规则

### 4.1 文本规范化

- 去首尾空白
- 合并连续空格
- 转英文小写
- 统一常见英文标点

### 4.2 冲突规则

- 配置使用 `last-write-wins`
- 单词本按 `normalizedText` 合并
- 合并后：
  - `createdAt` 取更早
  - `lastSeenAt` 取更晚
  - `hitCount` 累加
  - `updatedAt` 取更晚
  - 删除状态取最新变化

### 4.3 离线和异常

- 本地写入总是优先成功
- 离线时只标记待同步
- 网络恢复后自动重试
- 授权过期时提示重新连接 Google Drive
- Drive 请求失败时保留本地数据，不回滚
- 远端 schema 更高时拒绝覆盖并提示版本不兼容

## 5. 品牌替换要求

- 扩展名、帮助链接、官网链接都需要替换成新品牌。
- 扩展内不再显示 Read Frog 登录入口。
- `Connect Google Drive` 保留，作为唯一同步入口。
- 旧的 `readfrog.app`、博客、Notebase、社区入口需要继续清理。
- 当前提交已经完成一部分主入口替换，但代码库里仍有残留文案和备用页面代码，后续需要继续清掉。

## 6. 当前实现状态

### 6.1 已完成

- 词库类型和存储逻辑
- 配置 schema 升级和迁移脚本
- 划词翻译后自动收藏
- 网页高亮
- 设置页中的词库设置和单词本列表
- Google Drive 同步载荷扩展到词库数据
- 后台自动同步定时器
- 主入口品牌和帮助链接替换的第一轮处理

### 6.2 仍需继续

- 清理剩余 `Read Frog`、`Notebase` 相关入口和文案
- 把同步冲突提示做成明确的 UI
- 检查官网静态页文案和下载入口
- 继续补覆盖词库功能的测试

## 7. 验收清单

- 手动划词翻译单词后，词条进入本地单词本。
- 手动划词翻译短句后，`8` 个词以内可以收藏，超过 `8` 个词不收藏。
- 相同词条重复收藏不会产生重复记录。
- 新设备连接同一 Google 账号后可以拉到词条。
- 已收藏词条在网页原文中再次出现时会自动高亮。
- 高亮不会污染扩展自己的 UI 区域。
- 设置页可以搜索、删除、清空、导出单词本。
- 授权过期后可以重新连接，数据不丢。
- 离线时本地收藏可继续使用，恢复网络后可以自动同步。
- 主入口不再要求官网登录。

## 8. 文件落点

- 文档：`docs/specs/2026-04-13-read-frog-google-drive-sync.md`
- 词库类型：`src/types/vocabulary.ts`
- 词库逻辑：`src/utils/vocabulary/`
- 高亮逻辑：`src/entrypoints/selection.content/use-vocabulary-highlighting.ts`
- 后台自动同步：`src/entrypoints/background/google-drive-sync.ts`
- 设置页入口：
  - `src/entrypoints/options/pages/config/vocabulary-settings.tsx`
  - `src/entrypoints/options/pages/config/vocabulary-library.tsx`
