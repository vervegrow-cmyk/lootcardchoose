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
- `src/skills/`：可复用技能（单动作）。
- `src/services/`：外部系统访问抽象（R2/Shopify/DB）。
- `src/repositories/`：Prisma repository pattern 抽象层。
- `src/utils/`：日志与 Discord embeds 工具。
- `src/config/`：环境变量加载与配置。
- `src/scripts/`：运维脚本（占位）。
- `data/gallery-images/`：本地图库资源目录（占位）。

## Agent / Skill / Service 边界

### Agents
- `GalleryAgent`：编排图库选卡流程（当前为空实现）。

预留：
- `lootcarddiy`
- `support`
- `orders`
- `affiliate`

### Skills
- `search-gallery`：仅负责检索图库。
- `select-card`：仅负责选卡决策。
- `create-checkout-link`：仅负责创建付款链接。

### Services
- `gallery.service`：图库数据访问抽象。
- `order.service`：订单与结算抽象。
- `shopify.service`：Shopify 接口抽象。
- `r2.service`：R2 对象存储抽象。
- `prisma.service`：数据库连接抽象。

### Repositories
- `gallery.repository`：GalleryCard 持久层访问。
- `order.repository`：Order 持久层访问。

## Hermes Registry

- `lootcardchoose` → `GalleryAgent`
- `lootcarddiy` → reserved
- `support` → reserved
- `orders` → reserved

## Router 规则（占位）

- `gallery_search`：找图/找卡/给我10张/风格关键词等。
- `gallery_select`：数字或“选择N”。
- `order_status`：订单查询。
- `help`：帮助指令。

## 频道规则（占位）

- 仅 `#lootcardchoose` 允许 GalleryAgent。
- 其他频道统一回复：请到 #lootcardchoose 使用图库选卡功能。

## Prisma Models

详见 [`prisma/schema.prisma`](prisma/schema.prisma)。

## Hermes 架构骨架

- Router：意图识别、channel 过滤、构建 HermesContext。
- Orchestrator：根据 intent 选择 Agent、执行生命周期管理。
- Registry：注册与发现 Agent / Skill。

## 第一阶段

只启用 `lootcardchoose` → `GalleryAgent`，不实现 AI 出图与多 Agent 协作。

## 开发路线图（建议顺序）

1. 补齐 Router/Orchestrator 日志与追踪。
2. 实现 GalleryAgent 技能编排。
3. 实现 Gallery Skills（检索、选卡、结算链接）。
4. 实现 Gallery/Order/Prisma Service 适配层。
5. 接入 Shopify（商品/结算）。
6. 接入 R2（图库存储与同步）。
7. Discord Bot 交互流程。

## 环境变量（示例）

参考 [`.env.example`](.env.example)。
