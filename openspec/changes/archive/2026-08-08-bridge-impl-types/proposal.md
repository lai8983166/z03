## Why

change 3b（server-finalize）移除了 server.ts 的 `@ts-nocheck`，但桥实现层 `TcpBridge.ts`（454 行）与 `js/Udp.ts`（198 行）顶部的 `@ts-nocheck` 显式留作"后续 change"——这是全后端仅剩的两条类型债。`protocol-regression-tests` 主 spec（TcpBridge.handleData / UdpBridge._handleMessage 等 50+ 测试）已构成完整安全网，本 change 在此网下把桥实现层类型一次性收齐，让 `npm run typecheck` 对全后端零例外生效。

## What Changes

- 移除 `TcpBridge.ts:1` 的 `// @ts-nocheck`，给该文件加完整 TS 类型（class 字段、构造器、方法签名、`CMD_*` 命令表、`handleData`/`emit` Buffer 联合）
- 移除 `js/Udp.ts:1` 的 `// @ts-nocheck`，同样收类型（UdpBridge class + CMD 命令表）
- 已有的 JSDoc（`@typedef CmdDef` / `@type {...}`）转为 TS `interface CmdDef` + `Record<string, CmdDef>`，避免重复
- 评估并清理 `bridges.ts` 内对 TcpBridge/UdpBridge 实例的 `// @ts-expect-error` 与 `as` 断言（若桥层类型已足够支撑 `.on`/`.init` 调用）
- **行为逐字不变**：与 protocol-layer-ts 的硬约束一致，只允许加类型标注，MUST NOT 改变任何变量赋值、表达式、控制流、字节布局、命令表数值；遗留调试代码（TcpBridge.js 已注释的 base64/HexString、UdpBridge 当前未被实例化的备选路径）保留并 TS 化，调用关系不变

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `protocol-regression-tests`: 把"协议层 JSDoc 类型注解"requirement 升级为"协议层完整 TS 类型（无 `@ts-nocheck`）"——`TcpBridge.ts`/`js/Udp.ts` 移除 `@ts-nocheck` 后通过 `npm run typecheck`
- `turntable`: 更新 bridges requirement 里"TcpBridge/UdpBridge 实例自身 @ts-nocheck 类型不完整 → 用 `as` 断言或 `// @ts-expect-error` 处理"的措辞——桥层类型补齐后，bridges.ts 内的 expect-error/as 视情移除（若清理成本过高则保留并注明原因）

## Impact

- **代码**：`TcpBridge.ts`（454 行）、`js/Udp.ts`（198 行）、可能 `bridges.ts`（清理 expect-error）
- **测试**：`tests/protocol/tcp-bridge.test.ts` + `tests/protocol/udp-bridge.test.ts` 作为安全网 MUST 全绿；测试代码本身无需改动（已通过 `new TcpBridge()` 构造实例调 `handleData`）
- **构建/CI**：`npm run typecheck` 对两个文件生效（之前被 `@ts-nocheck` 跳过）；预期会暴露一批类型错，逐个修
- **运行时**：零影响（只增类型标注，ts 编译擦除后运行时字节码与重构前一致）
- **依赖**：不引入新包（`@types/node` / `@types/ws` 已在）
- **样式/前端**：零改动（约束：不动 index.html/style.css/JS 样式）
