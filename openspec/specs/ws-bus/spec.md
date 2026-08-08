# Spec: ws-bus

> ws-bus 传输基础设施模块：WS 服务器创建 + clients 集合 + broadcast 工具 + 统一 close。供 server.ts 及后续业务模块使用。本 capability 在 server-split-modules change 中建立，是首个无 `@ts-nocheck` 的后端模块。

## Requirements

### Requirement: ws-bus 模块导出 createWsBus 工厂
项目 MUST 提供 `ws-bus.ts` 模块，导出 `createWsBus(port, portImg)` 工厂函数，返回包含 `wss`/`wssImg`（WebSocketServer）/`clients`/`imgClients`（Set<WebSocket>）/`broadcast`/`broadcastImg`/`broadcastBinary`/`close` 的对象。工厂 MUST 在 0.0.0.0 上创建两个 WebSocketServer。

#### Scenario: createWsBus 创建两个 WS 服务器
- **WHEN** 调用 `createWsBus(8081, 8082)`
- **THEN** 返回对象的 `wss` 监听 8081、`wssImg` 监听 8082（均 0.0.0.0），`clients`/`imgClients` 为空 Set

### Requirement: broadcast 仅向 OPEN 状态客户端发送
`broadcast(message)` MUST 将 message `JSON.stringify` 后遍历 `clients`，仅对 `readyState === WebSocket.OPEN` 的客户端调用 `send`；非 OPEN 的 MUST 跳过。`broadcastImg` 对 `imgClients` 行为相同。`broadcastBinary(buffer)` MUST 跳过 JSON 序列化，直接遍历 `clients` 发送原始 Buffer（仅 OPEN 客户端）。

#### Scenario: broadcast 跳过非 OPEN 客户端
- **WHEN** clients 含一个 OPEN、一个 CLOSED 的 mock 客户端，调用 `broadcast({type:"x"})`
- **THEN** 仅 OPEN 客户端的 `send` 被调用一次，参数为 `JSON.stringify({type:"x"})`

#### Scenario: broadcastBinary 发送原始 Buffer
- **WHEN** 调用 `broadcastBinary(Buffer.from([1,2,3]))`
- **THEN** OPEN 客户端 `send` 收到的是原始 Buffer，未被 JSON.stringify

### Requirement: ws-bus 完整 TS 类型（无 @ts-nocheck）
`ws-bus.ts` MUST 提供完整 TypeScript 类型（`WsBus` interface + 函数参数/返回值标注），MUST NOT 使用 `// @ts-nocheck`。`npm run typecheck` 的 node tsconfig MUST 检查它且通过。

#### Scenario: ws-bus 通过 typecheck
- **WHEN** 运行 `npm run typecheck`
- **THEN** node tsconfig（include ws-bus.ts）检查通过，无类型错误

### Requirement: server.ts 改用 ws-bus，broadcast 行为等价
server.ts MUST 通过 `createWsBus` 创建 WS 基础设施，原内联的 `wss`/`wssImg` 创建、`clients`/`imgClients` 声明、`broadcast`/`broadcastImg`/`broadcastBinary` 定义 MUST 移除（改用 wsBus 的）。所有原 `broadcast(`/`broadcastImg(`/`broadcastBinary(` 调用 MUST 改为 `wsBus.broadcast(`/`wsBus.broadcastImg(`/`wsBus.broadcastBinary(`。SIGINT 的 `wss.close(); wssImg.close();` MUST 改为 `wsBus.close()`。运行时 broadcast 行为 MUST 与重构前逐字等价。

#### Scenario: server.ts 无残留裸 broadcast 调用
- **WHEN** 在 server.ts 搜索 `[^.broadcast(`（前面不是 `.` 的裸 broadcast 调用）
- **THEN** 无匹配（所有 broadcast 都通过 wsBus. 调用）

#### Scenario: broadcast 运行时行为不变
- **WHEN** 用 `npm run dev:server` 启动，浏览器连 WS，触发一个 broadcast 事件（如 bridge ready）
- **THEN** 前端收到与重构前一致的 WS 消息
