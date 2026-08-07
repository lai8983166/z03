# Design: 3b-1 ws-bus 传输基础设施

## Context

change 3 把 server.js 转为 server.ts（tsx 运行），但保留 `@ts-nocheck`（类型债）+ 1792 行单体。本 change 是 change 3b 的第一个 sub-change，提取 broadcast 传输基础设施为独立模块 `ws-bus.ts`。

broadcast 被 30+ 处调用（bridge handler / 串口 / 视频 / 数据保存 / 控制路由全依赖），是后续所有业务模块提取的基础。ws-bus 是**首个无 @ts-nocheck 的后端模块**，开始还类型债。

## Goals / Non-Goals

**Goals**
- 提取 `ws-bus.ts`：WS 服务器创建 + clients/imgClients 集合 + broadcast/broadcastImg/broadcastBinary + close。
- server.ts 改用 wsBus（移除内联 WS 创建与 broadcast 定义；30+ 调用点改造；SIGINT）。
- ws-bus 完整 TS 类型（无 @ts-nocheck）+ 纯函数单测。
- 行为绝对不变。

**Non-Goals**
- 不搬 connection handler 的业务 message 分支（依赖 12 个数据保存状态 + 控制路由 + udpBridge，留 3b-4）。
- 不提取 video/data/control/bridges（3b-2~3b-5）。
- 不整体移除 server.ts @ts-nocheck（只 ws-bus.ts 这一个新文件无 @ts-nocheck）。
- 不改任何业务逻辑。

## Decisions

### D1. 薄传输层（WS 服务器 + clients + broadcast + close），connection 留 server.ts
ws-bus 只做"传输基础设施"：创建两个 WebSocketServer、维护 clients/imgClients 空 Set、提供 broadcast 工具、统一 close。**connection handler（wss.on/wssImg.on）整体留 server.ts**——它的 message 业务分支（视频 0xF0/激光 0xF1/黑匣子 0xF2/YC 0xF3 魔术字节 + handleJsonControlMessage + udpBridge.sendPacket）依赖大量业务状态，属业务逻辑，留 3b-4 控制路由提取时一并处理。这样 3b-1 改动可控（30+ broadcast 机械改造），不碰高风险业务搬迁。

### D2. broadcast 抽为纯函数（便于单测）
broadcast 逻辑抽为顶层纯函数 `broadcastTo(clients, message)` / `broadcastBinaryTo(clients, buffer)`，接收 clients Set。`createWsBus` 返回的 `broadcast`/`broadcastImg`/`broadcastBinary` 是这些纯函数的偏应用（绑定 ws-bus 内部的 clients/imgClients）。
**测试只需测纯函数**（构造 mock WebSocket Set），**不调 createWsBus**（它会绑真实端口）。这是可测性的关键。

### D3. ws-bus 完整 TS 类型（无 @ts-nocheck）
导出 `WsBus` interface + `createWsBus`/`broadcastTo`/`broadcastBinaryTo` 函数签名全部标注。types 来自 `ws` 包（WebSocketServer/WebSocket）。ws-bus.ts 不加 @ts-nocheck，被 node tsconfig 检查。

### D4. server.ts broadcast 调用机械改造
30+ 处替换（前缀加 `wsBus.`）：
- `broadcast({` → `wsBus.broadcast({`
- `broadcastImg({` → `wsBus.broadcastImg({`
- `broadcastBinary(` → `wsBus.broadcastBinary(`
- connection handler 内 `clients.add/delete` → `wsBus.clients.add/delete`；`imgClients` 同理
- SIGINT `wss.close(); wssImg.close();` → `wsBus.close();`
机械替换，逻辑逐字等价。grep 复核无残留裸 `broadcast(`。

### D5. clients/imgClients 由 server.ts connection handler 填充
ws-bus 只创建空 Set 并暴露引用。connection handler（留 server.ts）做 `wsBus.clients.add(ws)` / `delete`。broadcast 遍历同一 Set 引用——行为与原 server.ts 内联 clients 完全等价。

### D6. wss/wssImg 暴露给 server.ts 注册 connection
createWsBus 返回 `wss`/`wssImg`（原始 WebSocketServer），server.ts 在上面 `.on("connection", ...)` 注册业务 handler。ws-bus 不接管 connection 事件。

## Risks / Trade-offs

- **30+ broadcast 改造漏改** → 机械替换 + grep 复核 `[^.]broadcast(` 无残留；50 旧测试 + ws-bus 新测试 + 人工对照。
- **ws-bus 类型不完整** → 接口简单（WebSocketServer/Set/WebSocket），typecheck 验证。
- **clients 引用一致性** → ws-bus 暴露 Set 引用，server.ts 操作同一 Set，broadcast 遍历同一 Set，等价。
- **ws-bus.ts 新文件被根 tsconfig 通过测试 import 误抓** → ws-bus.ts 在根目录，根 tsconfig include 是明确列出（vite/vitest config + tests + js/*.js），不含 ws-bus.ts；node tsconfig include ws-bus.ts。测试不直接 import ws-bus（测纯函数从 tests/ws-bus.test.ts，该测试在根 tsconfig，import ../ws-bus → tsc 跟随检查 ws-bus.ts，用根设置 ESNext——ws-bus.ts 用 ESM export，OK）。

## Migration Plan

- 开发工具 change，无部署迁移。
- 顺序：创建 ws-bus.ts（含纯函数 + createWsBus）→ tsconfig.node include 加 ws-bus.ts → server.ts 改用 wsBus（import + 移除内联 + 30+ 改造 + SIGINT）→ 写 ws-bus 测试 → typecheck + test + tsx 启动对照 → git commit。
- 回滚：`git revert`。ws-bus.ts 删除 + server.ts 恢复内联。
