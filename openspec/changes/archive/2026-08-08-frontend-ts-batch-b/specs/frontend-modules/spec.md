# Spec Delta: frontend-modules（批 B 中等文件迁移）

> 本 change 把 frontend-modules capability 的批 B 5 个中等文件（500-1500 行）迁移到 .ts。

## MODIFIED Requirements

### Requirement: 前端业务模块以 .ts 形式存在并提供完整 TS 类型
项目 `js/` 下的前端业务模块 MUST 以 `.ts` 形式存在，提供完整 TypeScript 类型（class 字段、函数签名、DOM 操作 narrowing、事件 payload inline 类型）。迁移按规模分批进行：
- ✅ **批 A（frontend-ts-batch-a，已完成）**：8 个小文件
- ✅ **批 B（本 change）**：5 个中等文件——`YC.ts` / `ImageUpload.ts` / `DataRouter.ts` / `CodeUpload.ts` / `TurntableControl.ts`
- ⏳ **批 C（后续 change）**：2 个大文件——`Video.ts` / `Command.ts`
- ⏳ **批 D（独立决策）**：`main.js` + index.html

#### Scenario: 批 B 5 个文件全部通过 typecheck
- **WHEN** 运行 `npm run typecheck`
- **THEN** tsconfig.json 检查 5 个新 .ts 文件并通过，0 错（允许跨 .js 边界处用 `// @ts-expect-error` 注明 change C 处理）

#### Scenario: 批 B 5 个文件无 @ts-nocheck
- **WHEN** grep 5 个文件的 `@ts-nocheck`
- **THEN** 无匹配

#### Scenario: 批 B 后前端测试仍全绿
- **WHEN** 运行 `npm test`
- **THEN** 61/61 全绿

### Requirement: 行为逐字不变（前端模块）
（同 frontend-modules 主 spec 的"行为逐字不变"requirement，批 B 5 个文件加入约束范围）

#### Scenario: 批 B 5 个文件 git diff 去掉类型后逐字一致
- **WHEN** 对 5 个文件运行 `git diff`，去掉所有类型标注后
- **THEN** 可执行代码部分与重构前逐字一致（含样式代码完全不动）
