# Spec Delta: turntable（bridges 内 expect-error 清理）

> 本 change 完成桥层类型补齐后，`bridges.ts` 内对 TcpBridge/UdpBridge 实例 `.on`/`.init` 的 `// @ts-expect-error` 与 `as` 断言视情清理或保留注明原因。

## MODIFIED Requirements

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
