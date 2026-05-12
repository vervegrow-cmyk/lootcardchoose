# LootCard Choose

Discord + Shopify + R2 + Gallery Card Selection System。

## Hermes 架构图

```
Discord Bot
  -> Router
    -> Orchestrator
      -> Agent
        -> Skill
          -> Service
            -> External Systems
```

## 目录结构与职责

- `src/bot/`：Discord 入口层，仅收发消息并转交 Hermes。
- `src/hermes/`：Hermes 核心层（Router/Orchestrator/Registry/Types）。
- `src/agents/`：Agent 实现与类型定义。
- `src/skills/`：可复用技能（检索/选卡/结算）。
- `src/services/`：外部系统访问抽象（R2/Shopify/DB/LLM/Discord 通知）。
- `src/repositories/`：Prisma repository pattern 抽象层（Gallery/Order/Session/Shopify Installation）。
- `src/utils/`：日志与 Discord embeds 工具。
- `src/config/`：环境变量加载与配置。
- `src/scripts/`：运维脚本（占位）。
- `data/gallery-images/`：本地图库资源目录（占位）。

## Agent / Skill / Service 边界

### Agents
- `GalleryAgent`：编排图库选卡流程（检索 → 选卡 → 生成 Shopify 结算链接）。

预留：
- `lootcarddiy`
- `support`
- `orders`
- `affiliate`

### Skills
- `gallery.search`：检索图库并写入检索会话。
- `gallery.selectCard`：从最近一次检索结果中选择卡牌并创建待支付订单。
- `gallery.createCheckoutLink`：在 Shopify 创建商品并生成结算链接。

### Services
- `gallery.service`：图库检索/结构化关键词解析/结果去重。
- `order.service`：订单创建、更新与支付状态处理。
- `shopify.service`：Shopify 商品与结算链接创建。
- `shopify-webhook.service`：订单支付 webhook 校验与状态更新。
- `shopify-installation.service`：Shopify 安装与 access token 管理。
- `r2.service`：R2 对象存储上传/删除/列表。
- `gallery-vision-metadata.service`：图片分析生成元数据（SiliconFlow Vision）。
- `llm-intent-classifier.service`：意图识别（DeepSeek + 规则回退）。
- `llm-query-parser.service`：自然语言解析为结构化检索条件。
- `discord-notification.service`：订单支付后 DM + 频道通知。
- `prisma.service`：数据库连接与健康判断。

### Repositories
- `gallery.repository`：GalleryCard 检索与同步落库。
- `gallery-search-session.repository`：检索会话持久化与选卡状态。
- `order.repository`：订单持久化与状态更新。
- `shopify-installation.repository`：Shopify 安装记录持久化。

## Hermes Registry

- `lootcardchoose` → `GalleryAgent`
- `lootcarddiy` → reserved
- `support` → reserved
- `orders` → reserved

## Router 规则

- `gallery_search`：找图/找卡/风格关键词（规则 + LLM 意图兜底）。
- `gallery_select`：数字或“选择N”。
- `gallery_refresh`：换一批/更多结果。
- `order_status`：订单查询。
- `help`：帮助指令。
- `ignore`：空文本或无关内容。

## 频道规则

- 仅 `#lootcardchoose` 允许 GalleryAgent（Discord Bot 入口层直接过滤）。

## Prisma Models

详见 [`prisma/schema.prisma`](prisma/schema.prisma)。

## Hermes 架构骨架

- Router：意图识别、构建 HermesContext。
- Orchestrator：根据 intent 选择 Agent、执行生命周期管理。
- Registry：注册与发现 Agent / Skill。

## 运行流程概览

1. Discord Bot 接收消息并在 `#lootcardchoose` 频道内转交 Router。
2. Router 识别 intent（规则优先 + LLM 兜底）。
3. Orchestrator 调用 GalleryAgent。
4. GalleryAgent 根据 intent 执行：
   - `gallery_search` → `gallery.search` → 返回卡牌列表与选择提示。
   - `gallery_select` → `gallery.selectCard` → `gallery.createCheckoutLink` → 返回 Shopify 结算链接。
5. Shopify `orders/paid` webhook 更新订单并通过 Discord 通知用户。

## Gallery 同步与元数据

- 本地图库目录：`data/gallery-images/`（图片 + 同名 JSON metadata）。
- `sync-gallery-r2`：扫描本地图库 → 生成/校验元数据 → 上传 R2 → upsert GalleryCard → 清理失效记录与 R2 对象。
- 元数据生成：优先走 SiliconFlow Vision，失败则回退文件名推断。

## 脚本与测试

- `seed-gallery`：写入示例卡牌数据（用于本地验证）。
- `sync-gallery-r2`：同步本地图库到 R2 与数据库。
- `test-gallery-search`：验证检索解析与结果返回。
- `test-gallery-select`：验证选卡 + 生成结算链接流程（Shopify 调用可 mock）。
- `test-shopify-webhook`：验证支付 webhook HMAC 与订单状态更新。
- `test-core`：串行执行核心测试脚本。

## 第一阶段

只启用 `lootcardchoose` → `GalleryAgent`，不实现 AI 出图与多 Agent 协作。

## 开发路线图（建议顺序）

1. 完善 Router/Orchestrator 日志与追踪。
2. 优化 Gallery 检索解析与排序策略。
3. 完善 Shopify 安装与 webhook 监控。
4. 扩展 Gallery Vision 元数据覆盖范围。
5. 扩展多 Agent 协作能力。

## 环境变量（示例）

参考 [`.env.example`](.env.example)。

关键开关：
- `ENABLE_LOOTCARD_CHOOSE`：启用/禁用主流程。
- `ENABLE_NATURAL_LANGUAGE_SEARCH`：启用 LLM 查询解析。
- `ENABLE_GALLERY_VISION_METADATA`：启用图片元数据视觉分析。
