# Design: 3b-5 turntable/bridges + server 收尾

## Context

server.ts（663 行）剩 turntable（initTurntableSerial/sendToTurntableSerial）+ bridges（3 路 udpBridge 装配）+ 入口（HTTP/WS connection/SIGINT/装配）+ @ts-nocheck（3a 引入）。

本 change 提取 turntable/bridges 为独立类型化模块，移除 server.ts @ts-nocheck——change 3b 类型债终点。

## Goals / Non-Goals

**Goals**
- turntable.ts / bridges.ts 提取（无 @ts-nocheck）。
- server.ts 移 @ts-nocheck + dead import + 剩余入口类型化。
- 行为不变。

**Non-Goals**
- 不移 TcpBridge/Udp 的 @ts-nocheck（bridges.ts 用断言处理）。
- 不整体提取 connection handler（留 server.ts 入口）。
- 不补单测。

## Decisions

### D1. turntable.ts：createTurntable 工厂
opts: wsBus + serialPort + baudRate。闭包维护 turntableSerial/turntableSerialBuf/TURNTABLE_SERIAL_PORT。返回 init/send/setPort/close。逐字搬迁 initTurntableSerial（SerialPort open + data/error/close 事件 + broadcast）/ sendToTurntableSerial。setPort 封装关旧+设新+init。

### D2. bridges.ts：createBridges 工厂
opts: wsBus + bridgesConfig[3] + TcpBridge/UdpBridge 构造器。装配 3 路（事件监听 + init）。3 路事件不同（Bridge 1 多事件 + received/sent；Bridge 2 含 raw_text；Bridge 3 用 broadcastImg），逐字搬迁（3 路分别 setup）。返回 close（3 路 close）。

TcpBridge/UdpBridge 实例因 @ts-nocheck 类型不完整，bridges.ts 用 `as unknown as <Type>` 断言或 `// @ts-expect-error` 处理 .on/.init。

### D3. server.ts @ts-nocheck 收尾
移除 @ts-nocheck + dead import（spawn/ExcelJS）。剩余入口（HTTP createServer + WS connection handler + SIGINT + cfg + 装配）类型化：
- HTTP：req（http.IncomingMessage）/res（http.ServerResponse）—— http 模块自带类型
- WS connection：ws（WebSocket from "ws"）
- message：Buffer | string 联合，需 narrowing（Buffer.isBuffer 判断）
- cfg：Config 类型（loadConfig 返回）
- 装配：模块实例（wsBus/data/video/control/turntable/bridges）

移除后 tsc 报错（数量不确定，预计 10-30）。逐个修：优先完整类型注解；成本过高处用 `// @ts-expect-error <原因>`。

### D4. control 的 turntable 注入改用 turntable 实例
3b-4 的 control.opts.turntable.send/setPort 是内联（sendToTurntableSerial + 封装 setPort）。3b-5 提取 turntable 后，改用 turntable 实例：`turntable: { send: (buf) => turntable.send(buf), setPort: (port) => turntable.setPort(port) }`。

### D5. 无单测（同前几个 IO change）
turntable（SerialPort）/bridges（UDP/WS）涉及 IO，无可单测纯函数。靠 tsx 启动 + 人工对照。

## Risks / Trade-offs

- **@ts-nocheck 移除后类型错数量不确定** → 逐个修；局部 expect-error 兜底。这是本 change 最大不确定点。
- **TcpBridge @ts-nocheck 影响 bridges.ts** → 断言处理。
- **turntable/bridges 搬迁** → 逐字搬 + tsx 对照。
- **dead import 误删** → grep 确认 spawn/ExcelJS 无引用。
- **两个 SIGINT**（bridges SIGINT line 503 + video SIGINT line 579）→ 保留两个（Node 多 SIGINT listener），turntable/bridges.close 在 bridges SIGINT。

## Migration Plan

- 顺序：turntable.ts → bridges.ts → server.ts（移内联 + 创建实例 + control.turntable 改 + 移 @ts-nocheck + 修类型错）→ typecheck（迭代修错）→ test + tsx → commit。
- 回滚：`git revert`。
