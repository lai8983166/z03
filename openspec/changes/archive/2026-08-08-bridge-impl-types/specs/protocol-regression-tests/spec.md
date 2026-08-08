# Spec Delta: protocol-regression-tests（桥实现层完整 TS 类型）

> 本 change 把 `TcpBridge.ts` 与 `js/Udp.ts` 的 JSDoc 类型注解升级为完整 TS 类型，并移除顶部 `@ts-nocheck`。`js/CommandBuilder.js` / `js/BinaryTableHelper.js` 不在本 change 范围（仍维持 JSDoc）。

## MODIFIED Requirements

### Requirement: 协议层 JSDoc 类型注解
4 个协议层源文件（`TcpBridge.ts`、`js/Udp.ts`、`js/CommandBuilder.js`、`js/BinaryTableHelper.js`）MUST 添加类型注解（JSDoc 或 TS 类型），使 `tsc --noEmit`（tsconfig.node 与 tsconfig.json）能识别字段、参数、返回值类型。其中：
- `TcpBridge.ts` 与 `js/Udp.ts` MUST 提供完整 TS 类型（class 字段、方法签名、命令表 `interface`/`Record<string, CmdDef>`、Buffer 处理），MUST 移除顶部 `// @ts-nocheck`
- `js/CommandBuilder.js` 与 `js/BinaryTableHelper.js` 维持现有 JSDoc 注解（本 change 不升级，留后续 change）

#### Scenario: TcpBridge.ts 与 js/Udp.ts 通过 typecheck 且无 @ts-nocheck
- **WHEN** 运行 `npm run typecheck`
- **THEN** tsconfig.node.json 检查 `TcpBridge.ts` 与 `js/Udp.ts`（不再被 `@ts-nocheck` 跳过）并通过，无类型错误（允许极少数成本过高处用 `// @ts-expect-error` 注明原因）

#### Scenario: grep 复核两个桥文件无 @ts-nocheck
- **WHEN** grep `TcpBridge.ts` 与 `js/Udp.ts` 的 `@ts-nocheck`
- **THEN** 无匹配（已移除）

#### Scenario: CommandBuilder.js 与 BinaryTableHelper.js 维持 JSDoc
- **WHEN** 运行 `npm run typecheck`
- **THEN** tsconfig.json 仍以 JSDoc 模式识别这两个 .js 文件，命令以退出码 0 通过（与 protocol-layer-ts 后状态一致，本 change 未改动它们）

#### Scenario: 协议解析测试全绿（行为未变）
- **WHEN** 运行 `npm test`
- **THEN** tests/protocol/tcp-bridge.test.ts 与 tests/protocol/udp-bridge.test.ts 的全部测试通过（断言形状未变，证明类型化未误改协议逻辑）

### Requirement: 源文件行为逐字不变
`TcpBridge.ts` 与 `js/Udp.ts` 的可执行语句 MUST 逐字不动——本 change 只允许：移除 `// @ts-nocheck` 行、新增类型标注（interface/type/字段声明/参数与返回值类型）、把 `@typedef CmdDef` 与 `@type {…}` 转 TS 等价物、在类型化成本过高的局部加 `// @ts-expect-error` 并注明原因。MUST NOT 改变任何变量赋值、表达式、控制流、字节布局、命令表数值（CMD_54/CMD_32/CMD_4A/CMD 等）。

#### Scenario: 两个桥文件 git diff 去掉类型后逐字一致
- **WHEN** 对 `TcpBridge.ts` 与 `js/Udp.ts` 运行 `git diff`，去掉所有类型标注（interface/type/字段声明/`: T`/`as T`/`// @ts-expect-error`）后
- **THEN** 可执行代码部分与重构前逐字一致（无任何逻辑改动）
