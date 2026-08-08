## Why

change 3c 把桥实现层的 `@ts-nocheck` 清零后，全后端已无类型债逃生舱，但 tsconfig 仍是 `strict: false`——大量 implicit any 参数、未检 null、unknown 类型仍能静默通过编译。开 `strict: true` 是 TypeScript 工程化的标准门禁，能把这些潜在 bug 在编译期拦住。当前评估：约 47 个编译错，可控范围，单 change 可完成。

## What Changes

- 装 `@types/ws`（当前缺失，导致 5 处 `ws` 模块 implicit any）作为 devDependency
- `tsconfig.json` 与 `tsconfig.node.json` 把 `"strict": false` 改为 `"strict": true`
- 跑 `npm run typecheck` 收集所有 strict 错（~47 处），逐个修：
  - **implicit any 参数**（~30 处）：加显式类型，主要在 `config.ts`（验证函数）、`server.ts`（WS connection / message 回调）、`TcpBridge.ts`（err 回调）
  - **null check**（1 处）：`data.ts` 的 `_psWorker` possibly null，加 narrowing 或 `!` 断言
  - **index signature**（1 处）：`server.ts` 的 `mimeTypes[ext]`，改 `Record<string, string>`
  - **unknown**（2 处）：`config.ts` catch 块的 `e`，narrowing 或断言
  - **overload**（1 处）：`TcpBridge.ts` 的 `socket.on('message', ...)`，回调签名匹配
- 测试代码（`tests/**/*.ts`）的 strict 错同样修
- **行为逐字不变**：仅加类型标注、必要 narrowing、`!` 断言、index signature；不改任何业务逻辑

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `ts-engineering-baseline`: "TypeScript 编译与类型检查能力" requirement 从 `strict: false` 升级为 `strict: true`；新增"全后端 + 测试通过 strict 检查"scenario；`@types/ws` 加入 devDependencies

## Impact

- **配置**：`tsconfig.json` / `tsconfig.node.json`（strict: true）；`package.json`（加 @types/ws）
- **代码**：`config.ts`（~14 错）、`server.ts`（~7 错）、`TcpBridge.ts`（~4 错）、`data.ts`（1 错）、`js/Udp.ts`（少量）、`bridges.ts`（少量）、`turntable.ts`（少量）、`control.ts`（少量）、`ws-bus.ts`（装 @types/ws 后自动解决）；`tests/**/*.ts`（~12 错，主要为 ws 类型）
- **构建/CI**：`npm run typecheck` 启用 strict 后必须 0 错；`npm test` 61 测试保持全绿
- **运行时**：零影响（类型标注编译擦除）
- **依赖**：新增 `@types/ws` devDependency
- **样式/前端**：零改动
