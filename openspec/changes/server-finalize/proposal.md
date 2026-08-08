# Proposal: 3b-5 turntable/bridges 提取 + server.ts @ts-nocheck 收尾（change 3b 终点）

## 背景：change 3b 最后一站

3b-1~3b-4 已提取 ws-bus/video/data/control。server.ts 剩 turntable（initTurntableSerial/sendToTurntableSerial）+ bridges（3 路 udpBridge 装配）+ 入口（HTTP/WS connection/SIGINT/装配）+ @ts-nocheck。

本 change（3b-5）提取 turntable/bridges + **移除 server.ts @ts-nocheck**（还类型债终点）。

## Why

1. turntable/bridges 是 server.ts 剩余两块职责，提取后 server.ts 只剩入口装配。
2. 移除 server.ts @ts-nocheck——3a 引入的类型债在 3b 系列终点还清（ws-bus/video/data/control/turntable/bridges 都无 @ts-nocheck，server.ts 入口也类型化）。
3. TcpBridge/Udp 自身的 @ts-nocheck 不在本 change（留后续；bridges.ts 用 TcpBridge 时用类型断言/as 处理其不完整类型）。

## What Changes

### 1. 新建 `turntable.ts`（完整类型，无 @ts-nocheck）
`createTurntable(opts)` 工厂（opts: wsBus + serialPort + baudRate），返回 `{ init(), send(buf), setPort(port), close() }`。逐字搬迁 initTurntableSerial/sendToTurntableSerial + 状态（turntableSerial/turntableSerialBuf/TURNTABLE_SERIAL_PORT）。

### 2. 新建 `bridges.ts`（完整类型，无 @ts-nocheck）
`createBridges(opts)` 工厂（opts: wsBus + bridgesConfig[3] + TcpBridge/UdpBridge 构造器），返回 `{ close() }`。逐字搬迁 3 路 udpBridge 装配（事件监听 ready/rs485/heixiazi/YC/laser_data/chart_update/SJCJ_trigger/received/sent/raw_text/error + init）。每路事件逻辑保留（broadcast/broadcastBinary/broadcastImg）。

TcpBridge/UdpBridge 实例因自身 @ts-nocheck 类型不完整，bridges.ts 用 `as` 断言或 `// @ts-expect-error` 处理（不改 TcpBridge/Udp）。

### 3. server.ts 收尾
- 移除 `// @ts-nocheck`（line 1-3）
- 移除 dead import（`spawn`（video/data 迁了）、`ExcelJS`（data 迁了）；保留 `http`/`WebSocket`（类型）/`path`/`fs`/`UdpBridge`/`TcpBridge`/`SerialPort`（bridges/turntable 用，或迁后移）/`loadConfig`/createWsBus/createVideo/createData/createControl/createTurntable/createBridges）
- import createTurntable/createBridges
- 创建 turntable/bridges 实例（替代内联）
- 移除 turntable 函数/状态 + bridges 装配
- 移除 turntable 的 control 注入（control.opts.turntable 改用 turntable 实例）
- 剩余入口（HTTP createServer + WS connection handler + SIGINT + cfg + 装配）**类型化**：移除 @ts-nocheck 后 tsc 报错，逐个修（HTTP req/res 用 http 类型、WS ws 用 WebSocket 类型、message 用 Buffer 联合 + narrowing、cfg 用 Config 类型）。类型错数量不确定（预计 10-30），用类型注解/断言/`@ts-expect-error` 处理。

### 4. 测试：无新单测
turntable/bridges 涉及 IO（SerialPort/UDP/WS），无可单测的纯函数。靠 tsx 启动 + 人工对照。

### 不在本 change 范围
- ❌ TcpBridge/Udp 移除 @ts-nocheck（留后续，bridges.ts 用断言处理）
- ❌ connection handler 整体提取（留 server.ts 入口，本 change 只类型化）
- ❌ 前端 change 4/5

## Capabilities

### New Capabilities
- `turntable`：转台串口模块（init/send/setPort/close + 数据行广播）
- `bridges`：3 路 UDP/TCP 桥接装配（事件监听 + init + close）

### Modified Capabilities
- `backend-ts-runtime`：server.ts 移除 @ts-nocheck（3a 的类型债还清）。

## Impact

### 新增文件
- `turntable.ts` / `bridges.ts`（完整类型，无 @ts-nocheck）
- `openspec/specs/turntable/spec.md` / `openspec/specs/bridges/spec.md`

### 修改文件
- `server.ts`：移 @ts-nocheck + dead import；移 turntable/bridges 内联；创建 turntable/bridges 实例；剩余入口类型化（修类型错）
- `tsconfig.node.json`：include 加 turntable.ts/bridges.ts
- `control` 创建处：turntable 注入改用 turntable 实例（opts.turntable.send/setPort → turntable.send/setPort）

### 不变
- turntable/bridges 运行行为（事件监听/init/SIGINT close 逐字搬迁）
- HTTP/WS/connection handler 逻辑（只类型化，不改行为）
- `index.html`/`style.css`/前端 JS
- 61 测试仍绿

### 验收
- `npm run typecheck` 通过（**server.ts 移除 @ts-nocheck 后，全后端类型检查通过**——这是 change 3b 的类型债终点）
- `npm test` 通过（61）
- `npm run dev:server`（tsx）启动正常（含 turntable/bridges 创建）
- 人工触发对照（turntable SET_TURNTABLE_PORT/SEND_TO_BRIDGE2 + bridges UDP 事件）
- git 提交一次

### 风险与对策
- **@ts-nocheck 移除后类型错数量不确定** → 逐个修（类型注解/断言/`@ts-expect-error`）；如果某处类型化成本过高，局部保留 `// @ts-expect-error` 并注释原因（优先完整类型，次选 expect-error）。
- **TcpBridge/Udp @ts-nocheck 导致 bridges.ts 类型不完整** → bridges.ts 用 `as` 断言（TcpBridge 实例的方法/属性）。
- **turntable/bridges 搬迁** → 逐字搬迁 + tsx 启动对照。
- **dead import 误删** → grep 确认 spawn/ExcelJS 在 server.ts 无引用（video/data 迁了）。
