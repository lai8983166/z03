# Spec Delta: turntable + bridges + server 收尾

> 本 change 提取 turntable/bridges + 移除 server.ts @ts-nocheck（change 3b 类型债终点）。

## ADDED Requirements

### Requirement: turntable 模块
项目 MUST 提供 `turntable.ts`，导出 `createTurntable(opts)` 工厂（opts: wsBus + serialPort + baudRate），返回 `{ init(), send(buf), setPort(port), close() }`。逐字搬迁 initTurntableSerial/sendToTurntableSerial + 状态。

#### Scenario: init 打开串口 + broadcast ready
- **WHEN** 调用 `turntable.init()` 成功打开串口
- **THEN** wsBus.broadcast turntable_serial_ready（与重构前一致）

#### Scenario: setPort 切串口
- **WHEN** 调用 `turntable.setPort("COM8")`
- **THEN** 关闭旧串口（若 isOpen）+ 设新 port + 重新 init（封装原 SET_TURNTABLE_PORT 逻辑）

### Requirement: bridges 模块
项目 MUST 提供 `bridges.ts`，导出 `createBridges(opts)` 工厂（opts: wsBus + bridgesConfig[3] + TcpBridge/UdpBridge 构造器），返回 `{ close() }`。逐字搬迁 3 路 udpBridge 装配（事件监听 + init）。

#### Scenario: Bridge 1 ready 广播 udp_ready
- **WHEN** Bridge 1 触发 ready 事件
- **THEN** wsBus.broadcast udp_ready（与重构前一致）

#### Scenario: Bridge 3 ready 广播 udp3_ready（imgClients）
- **WHEN** Bridge 3 触发 ready
- **THEN** wsBus.broadcastImg udp3_ready（走图像 WS 通道，与重构前一致）

## MODIFIED Requirements

### Requirement: server.ts 移除 @ts-nocheck（backend-ts-runtime 修改）
server.ts MUST 移除顶部 `// @ts-nocheck`。`npm run typecheck` 的 node tsconfig MUST 对 server.ts 进行类型检查并通过（剩余入口代码类型化：HTTP req/res、WS ws、message Buffer 联合、cfg Config、装配）。允许在类型化成本过高的局部使用 `// @ts-expect-error` 并注释原因。

#### Scenario: server.ts 通过 typecheck（无 @ts-nocheck）
- **WHEN** 运行 `npm run typecheck`
- **THEN** node tsconfig 检查 server.ts（不再跳过）并通过

#### Scenario: server.ts 无 @ts-nocheck
- **WHEN** grep server.ts `@ts-nocheck`
- **THEN** 无匹配（已移除）

### Requirement: server.ts 移除 dead import
server.ts MUST 移除 `spawn` 与 `ExcelJS` 的 import（已随 video/data 迁出，server.ts 无引用）。

#### Scenario: server.ts 无 dead import
- **WHEN** grep server.ts `from "child_process"`（spawn）/`from "exceljs"`
- **THEN** 无匹配（已移除；除非其他代码仍用，若用则保留）

### Requirement: control 的 turntable 注入改用 turntable 实例
server.ts 创建 control 时，opts.turntable.send/setPort MUST 改用 turntable 实例（`turntable.send`/`turntable.setPort`），替代原内联 sendToTurntableSerial/封装逻辑。

#### Scenario: control.turntable.send 走 turntable 实例
- **WHEN** control 的 SEND_TO_BRIDGE2 调 opts.turntable.send(buf)
- **THEN** 调用 turntable 实例的 send（与原 sendToTurntableSerial 行为一致）
