# Proposal: 3b-1 提取 ws-bus 传输基础设施

## 背景：change 3b 分多个 sub-change

change 3 把后端转 .ts 但保留了 `@ts-nocheck`（类型债）+ server.ts 仍是 1792 行单体。change 3b 按"分多个 sub-change"策略（用户确认）逐步拆分，每个 sub-change 提取一个职责 + 补类型 + 移除该部分 @ts-nocheck + 配套测试，独立 commit。

| sub-change | 范围 | 状态 |
|---|---|---|
| **3b-1（本 change）** | **提取 ws-bus 传输基础设施** | 进行中 |
| 3b-2 | 提取 video（RTSP/ffmpeg 红外 + 二值化） | 待启动 |
| 3b-3 | 提取 data（Excel 保存 SJCJ/Video/JG/Blackbox/YC/Heixiazi + PowerShell + 文件对话框） | 待启动 |
| 3b-4 | 提取 control（handleJsonControlMessage/handleControlCommand + WS connection handler 业务搬迁） | 待启动 |
| 3b-5 | 提取 bridges/turntable + 收尾 server.ts @ts-nocheck | 待启动 |

## Why

`broadcast`/`broadcastImg`/`broadcastBinary` 被 **30+ 处**调用（bridge handler、串口、视频、数据保存、控制路由全依赖），是所有后续模块都要用的传输基础设施。先把它提取为独立模块：

1. 为 3b-2/3b-3/3b-4 的业务模块提取提供干净的 `wsBus.broadcast` 接口。
2. broadcast 纯逻辑可独立单测（mock WebSocket，不绑端口）。
3. ws-bus 是新文件，自带完整 TS 类型（**首个移除 @ts-nocheck 影响范围的后端模块**），逐步还类型债。
4. server.ts 减少约 50 行（WS 创建 + broadcast 定义）。

## What Changes

### 1. 新建 `ws-bus.ts`（根目录，与 server.ts 同级）
导出 `createWsBus(port, portImg)` 工厂，返回：
- `wss` / `wssImg`：两个 `WebSocketServer`（由 ws 创建，host 0.0.0.0）
- `clients` / `imgClients`：`Set<WebSocket>`（**由 server.ts 的 connection handler 填充**——ws-bus 只创建空 Set）
- `broadcast(message)` / `broadcastImg(message)` / `broadcastBinary(buffer)`：遍历对应 Set，readyState===OPEN 才 send（逻辑与原 server.ts 逐字等价）
- `close()`：关两个 wss

**完整 TS 类型**（`WsBus` interface），**不加 @ts-nocheck**。

### 2. server.ts 改用 ws-bus
- 移除 `wss`/`wssImg` 创建（line 82-93）、`clients`/`imgClients` 声明（line 95, 147）、`broadcast`/`broadcastImg`/`broadcastBinary` 定义（line 129-145, 539-546）
- 顶部 `import { createWsBus } from "./ws-bus"; const wsBus = createWsBus(WS_PORT, WS_PORT_IMG);`
- 30+ 处 `broadcast({...})` → `wsBus.broadcast({...})`；`broadcastImg`/`broadcastBinary` 同理
- `clients.add/delete`（connection handler 内）→ `wsBus.clients.add/delete`；`imgClients` 同理
- SIGINT handler 的 `wss.close(); wssImg.close();` → `wsBus.close();`
- **connection handler（wss.on/wssImg.on）整体留 server.ts**——其 message 业务分支（视频/激光/黑匣子/YC 魔术字节 + handleJsonControlMessage + UDP 转发）依赖 12 个数据保存状态 + 控制路由 + udpBridge，属业务逻辑，留 3b-4 处理

### 3. ws-bus 单测
`tests/ws-bus.test.ts`：测 `broadcast`/`broadcastImg`/`broadcastBinary` 纯逻辑——构造 mock WebSocket（只有 `readyState`/`send`），填入 clients Set，调 broadcast，断言 send 被调用 / 非 OPEN 的不调。**不创建真实 WebSocketServer、不绑端口**（createWsBus 工厂本身不测，只测 broadcast 纯函数，或把 broadcast 抽为可独立测试的纯函数）。

### 不在本 change 范围
- ❌ connection handler 业务搬迁（留 3b-4）
- ❌ video/data/control/bridges/turntable 模块提取（3b-2~3b-5）
- ❌ server.ts 整体移除 @ts-nocheck（只 ws-bus.ts 这一个新文件无 @ts-nocheck；server.ts 仍 @ts-nocheck，等其他模块提取后再收尾）
- ❌ 任何业务逻辑改动

## Capabilities

### New Capabilities
- `ws-bus`：WebSocket 传输基础设施——WS 服务器创建、clients 集合、broadcast 工具、统一 close。供 server.ts 及后续业务模块使用。

### Modified Capabilities
- 无（不改 change 1 的 ts-engineering-baseline / change 3 的 backend-ts-runtime 的 capability 定义）。

## Impact

### 新增文件
- `ws-bus.ts`（带完整 TS 类型，无 @ts-nocheck）
- `tests/ws-bus.test.ts`
- `openspec/specs/ws-bus/spec.md`

### 修改文件
- `server.ts`：import ws-bus + 移除 WS 创建/broadcast 定义 + 30+ 处 broadcast 调用改造 + SIGINT 改造。业务逻辑逐字不动。
- `tsconfig.node.json`：include 加 `ws-bus.ts`

### 不变
- 所有运行时行为（broadcast 逻辑等价、WS 服务器等价）
- connection handler 的业务逻辑（视频/数据/控制/UDP 转发）
- `index.html`/`style.css`/前端 JS（全局约束）
- 遗留代码（ffmpeg）调用关系
- change 2 的 50 测试仍绿

### 验收
- `npm run typecheck` 通过（ws-bus.ts 无 @ts-nocheck，被 node tsconfig 检查；server.ts 仍 @ts-nocheck）
- `npm test` 通过（50 + ws-bus 新测试）
- `npm run dev:server`（tsx）启动，WS 监听日志与 change 3 一致
- 浏览器人工对照（broadcast 行为：前端收到 WS 消息与重构前一致）
- 本 change 验收通过后**立即 git 提交一次**

### 风险与对策
- **风险 1**：30+ broadcast 调用改造漏改/错改。**对策**：机械替换（`broadcast(`→`wsBus.broadcast(`），grep 复核无残留裸 `broadcast(`/`broadcastImg(`/`broadcastBinary(`；ws-bus 单测 + 50 旧测试 + 人工对照。
- **风险 2**：ws-bus.ts 新文件类型不完整导致 typecheck 失败。**对策**：ws-bus 接口简单（WebSocketServer/Set/WebSocket），类型易写完整；typecheck 验证。
- **风险 3**：connection handler 留 server.ts，引用 wsBus.clients，@ts-nocheck 下不报但运行时要正确。**对策**：wsBus.clients 是同一 Set 引用，connection 的 add/delete 直接作用其上，行为等价。
