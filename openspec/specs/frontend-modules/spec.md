# Spec: frontend-modules

> 前端业务模块（`js/` 下）的 TS 化与类型契约。本 capability 在 frontend-ts-batch-a change 中建立，并迁移首批 8 个小文件（<500 行）。后续 change B/C 继续迁移中等与大文件，change D 单独决策 main.js + index.html。

## Requirements

### Requirement: 前端业务模块以 .ts 形式存在并提供完整 TS 类型
项目 `js/` 下的前端业务模块 MUST 以 `.ts` 形式存在，提供完整 TypeScript 类型（class 字段、函数签名、DOM 操作 narrowing、事件 payload inline 类型）。迁移按规模分批进行：
- ✅ **批 A（frontend-ts-batch-a，已完成）**：8 个小文件——`Client.ts` / `ImageUploadClient.ts` / `StatusBar.ts` / `Chart.ts` / `Infrared.ts` / `Laser.ts` / `DataHandler.ts` / `Telemeter.ts`
- ⏳ **批 B（后续 change）**：5 个中等文件——`YC.ts` / `ImageUpload.ts` / `DataRouter.ts` / `CodeUpload.ts` / `TurntableControl.ts`
- ⏳ **批 C（后续 change）**：2 个大文件——`Video.ts` / `Command.ts`
- ⏳ **批 D（独立决策）**：`main.js` + index.html（涉及 index.html 改动约束，单独评估）

#### Scenario: 批 A 8 个文件全部通过 typecheck
- **WHEN** 运行 `npm run typecheck`
- **THEN** tsconfig.json（前端）检查 8 个新 .ts 文件并通过，0 错（允许极少数成本过高处用 `// @ts-expect-error` 注明原因）

#### Scenario: 批 A 8 个文件无 @ts-nocheck
- **WHEN** grep 8 个文件的 `@ts-nocheck`
- **THEN** 无匹配（新 .ts 文件本就无 @ts-nocheck）

#### Scenario: 批 A 后前端测试仍全绿
- **WHEN** 运行 `npm test`
- **THEN** 61/61 全绿（前端业务模块无单测，但协议层测试不受影响）

### Requirement: 前端模块间 import 路径统一去 .js 后缀
所有前端模块（`.ts` 与剩余 `.js`）的相对路径 import MUST 不带 `.js` 后缀，让 vite/tsx 自动解析（vite resolve.extensions 默认含 `.ts` 与 `.js`）。

#### Scenario: 批 A 8 个文件无 .js 后缀 import
- **WHEN** grep 8 个 .ts 文件的所有 `from "./..."` import
- **THEN** 路径均无 `.js` 后缀（含本 change 外的大文件如 `./Video`、`./Command`）

#### Scenario: 引用批 A 8 个文件的其他模块也无 .js 后缀
- **WHEN** grep 全项目 `from ".*Client\.js"` / `from ".*StatusBar\.js"` 等
- **THEN** 无匹配（已统一去后缀）

### Requirement: 行为逐字不变（前端模块）
所有已迁移的前端模块（含批 A 8 个文件）的可执行语句 MUST 逐字不动——只允许：rename 扩展名、新增类型标注、DOM 操作加 narrowing（运行时已隐式假设）、import 路径去 `.js` 后缀、在类型化成本过高的局部加 `// @ts-expect-error` 注明原因。MUST NOT 改变任何变量赋值、表达式、控制流、DOM 操作语义、事件监听逻辑、样式代码（element.style.* / className 等）。

#### Scenario: 已迁移文件 git diff 去掉类型后逐字一致
- **WHEN** 对已迁移的 .ts 文件运行 `git diff`，去掉所有类型标注（interface/type/字段声明/`: T`/`as T`/`// @ts-expect-error`/narrowing 守卫/import 路径后缀）后
- **THEN** 可执行代码部分与重构前逐字一致（含样式代码完全不动）
