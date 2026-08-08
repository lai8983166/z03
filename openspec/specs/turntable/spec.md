# Spec: turntable

> turntable + bridges 模块：转台串口控制 + 三路 UDP/TCP 桥装配。本 capability 在 server-finalize change 中建立（change 3b 终点）。

## Requirements

### Requirement: turntable 模块
项目 MUST 提供 `turntable.ts`，导出 `createTurntable(opts)` 工厂（opts: wsBus + serialPort + baudRate），返回 `{ init(), send(buf), setPort(port), close() }`。逐字搬迁 initTurntableSerial/sendToTurntableSerial + 状态。

#### Scenario: init 打开串口 + broadcast ready
- **WHEN** 调用 `turntable.init()` 成功打开串口
- **THEN** wsBus.broadcast turntable_serial_ready（与重构前一致）

#### Scenario: setPort 切串口
- **WHEN** 调用 `turntable.setPort("COM8")`
- **THEN** 关闭旧串口（若 isOpen）+ 设新 port + 重新 init（封装原 SET_TURNTABLE_PORT 逻辑）

### Requirement: bridges 模块
项目 MUST 提供 `bridges.ts`，导出 `createBridges(opts)` 工厂（opts: wsBus + bridgesConfig[3] + TcpBridge/UdpBridge 构造器），返回 `{ close() }`。逐字搬迁 3 路 udpBridge 装配（事件监听 + init）。TcpBridge/UdpBridge 实例的类型在 bridge-impl-types change 中补齐——`bridges.ts` 内对 `.on`/`.init` 的调用 MUST 直接通过 `npm run typecheck`；若仍存在 `// @ts-expect-error` 或 `as` 断言，MUST 在注释中注明具体原因（如"EventEmitter 自定义事件 ready/udp_data 的 TS 内置重载不识别"）。

#### Scenario: Bridge 1 ready 广播 udp_ready
- **WHEN** Bridge 1 触发 ready 事件
- **THEN** wsBus.broadcast udp_ready（与重构前一致）

#### Scenario: Bridge 3 ready 广播 udp3_ready（imgClients）
- **WHEN** Bridge 3 触发 ready
- **THEN** wsBus.broadcastImg udp3_ready（走图像 WS 通道，与重构前一致）

#### Scenario: bridges.ts 通过 typecheck（无 @ts-nocheck）
- **WHEN** 运行 `npm run typecheck`
- **THEN** tsconfig.node.json 检查 bridges.ts 通过；保留的 `// @ts-expect-error` 行均标注具体原因（无空注释的 expect-error）

### Requirement: turntable / bridges 完整 TS 类型（模块层无 @ts-nocheck）
`turntable.ts` 与 `bridges.ts` MUST 提供完整 TypeScript 类型（工厂函数签名 + opts/返回 interface），MUST NOT 在模块层使用 `// @ts-nocheck`。`npm run typecheck` 的 node tsconfig MUST 检查两者并通过。

#### Scenario: turntable/bridges 通过 typecheck
- **WHEN** 运行 `npm run typecheck`
- **THEN** node tsconfig（include turntable.ts + bridges.ts）检查通过

### Requirement: server.ts 移除 turntable/bridges 内联装配
server.ts MUST 移除 turntable 函数/状态（initTurntableSerial/sendToTurntableSerial/TURNTABLE_SERIAL_PORT/turntableSerial/turntableSerialBuf）+ bridges 装配（3 路 udpBridge + 事件 + init + 常量 USE_TCP/UDP*）。改由 createTurntable/createBridges 工厂创建实例注入。SIGINT 改用 `bridges.close()`（替代 udpBridge.close）+ `turntable.close()` 加入。

#### Scenario: server.ts 无 turntable/bridges 函数定义残留
- **WHEN** grep server.ts `initTurntableSerial`/`sendToTurntableSerial`/`TURNTABLE_SERIAL_PORT`/`turntableSerial`/`udpBridge`
- **THEN** 无业务定义匹配（已迁 turntable.ts/bridges.ts）
