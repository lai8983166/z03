# Spec Delta: protocol-regression-tests（CommandBuilder / BinaryTableHelper 升级 TS）

> 本 change 把 `js/CommandBuilder.js` + `js/BinaryTableHelper.js` rename 为 `.ts`，JSDoc 升级为完整 TS 类型；更新所有引用方 import 路径。

## MODIFIED Requirements

### Requirement: 协议层 JSDoc 类型注解
4 个协议层源文件（`TcpBridge.ts`、`js/Udp.ts`、`js/CommandBuilder.ts`、`js/BinaryTableHelper.ts`）MUST 添加类型注解（JSDoc 或 TS 类型），使 `tsc --noEmit`（tsconfig.node 与 tsconfig.json）能识别字段、参数、返回值类型。其中：
- `TcpBridge.ts` 与 `js/Udp.ts` MUST 提供完整 TS 类型（class 字段、方法签名、命令表 `interface`/`Record<string, CmdDef>`、Buffer 处理），MUST 移除顶部 `// @ts-nocheck`
- `js/CommandBuilder.ts` 与 `js/BinaryTableHelper.ts` MUST 提供完整 TS 类型（`interface MetaItem`、class 字段、方法签名、DOM 方法 narrowing、PacketManager 单例），MUST 由原 `.js` rename 为 `.ts`；原 JSDoc `@typedef` 转 TS `interface`，`@param`/`@returns` 注解保留作为文档

#### Scenario: 4 个协议层源文件全部通过 typecheck
- **WHEN** 运行 `npm run typecheck`
- **THEN** tsconfig.json（前端）与 tsconfig.node.json（后端）都通过；4 个文件均提供完整 TS 类型，0 错

#### Scenario: 4 个文件均无 @ts-nocheck
- **WHEN** grep `@ts-nocheck` 4 个文件
- **THEN** 无匹配（CommandBuilder/BinaryTableHelper 由 .js rename 为 .ts，本就无 @ts-nocheck；TcpBridge/Udp 已在 bridge-impl-types 移除）

#### Scenario: 测试 import 路径去 .js 后缀
- **WHEN** grep `tests/protocol/command-builder.test.ts` 与 `tests/protocol/binary-table-helper.test.ts` 的 import 路径
- **THEN** 不含 `.js` 后缀（去后缀让 vite 自动解析 .ts）

#### Scenario: 协议解析测试全绿（行为未变）
- **WHEN** 运行 `npm test`
- **THEN** tests/protocol/command-builder.test.ts 与 tests/protocol/binary-table-helper.test.ts 的全部测试通过（断言形状未变）

### Requirement: 源文件行为逐字不变
`TcpBridge.ts`、`js/Udp.ts`、`js/CommandBuilder.ts`、`js/BinaryTableHelper.ts` 4 个文件的可执行语句 MUST 逐字不动——只允许：移除 `// @ts-nocheck` 行（如有）、新增类型标注（interface/type/字段声明/参数与返回值类型）、把 `@typedef` 与 `@type {…}` 转 TS 等价物、在类型化成本过高的局部加 `// @ts-expect-error` 并注明原因、rename 文件扩展名、DOM 方法加 `if (!x) return` narrowing（运行时已隐式假设）。MUST NOT 改变任何变量赋值、表达式、控制流、字节布局、命令表数值、CSV 解析、scale/endian 计算。

#### Scenario: 4 个文件 git diff 去掉类型后逐字一致
- **WHEN** 对 4 个文件运行 `git diff`，去掉所有类型标注（interface/type/字段声明/`: T`/`as T`/`// @ts-expect-error`/narrowing 守卫）后
- **THEN** 可执行代码部分与重构前逐字一致（无任何逻辑改动）

### Requirement: import 路径统一（去 .js 后缀）
所有引用 `js/CommandBuilder` 或 `js/BinaryTableHelper` 的文件 MUST 更新 import 路径，去掉 `.js` 后缀（让 vite/tsx 自动解析 `.ts`）。

#### Scenario: 前端 JS import 路径更新
- **WHEN** grep `js/Command.js`、`js/ImageUpload.js`、`js/Telemeter.js`、`js/YC.js`、`main.js` 的 `BinaryTableHelper.js`
- **THEN** 无匹配（已改为 `./BinaryTableHelper` 或 `./js/BinaryTableHelper`，无 `.js` 后缀）

#### Scenario: 测试 import 路径更新
- **WHEN** grep `tests/protocol/{command-builder,binary-table-helper}.test.ts` 的 import 路径
- **THEN** 无 `.js` 后缀

#### Scenario: tsconfig include 更新
- **WHEN** 查看 `tsconfig.json` 的 include
- **THEN** 不含 `js/CommandBuilder.js` 与 `js/BinaryTableHelper.js`（已改为 `.ts`，或被通配规则覆盖）
