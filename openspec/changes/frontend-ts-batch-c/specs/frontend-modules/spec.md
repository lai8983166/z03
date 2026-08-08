# Spec Delta: frontend-modules（批 C 大文件迁移）

> 本 change 把 frontend-modules capability 的批 C 2 个大文件迁移到 .ts。

## MODIFIED Requirements

### Requirement: 前端业务模块以 .ts 形式存在并提供完整 TS 类型
项目 `js/` 下的前端业务模块 MUST 以 `.ts` 形式存在，提供完整 TypeScript 类型。迁移按规模分批进行：
- ✅ **批 A（frontend-ts-batch-a，已完成）**：8 个小文件
- ✅ **批 B（frontend-ts-batch-b，已完成）**：5 个中等文件
- ✅ **批 C（本 change）**：2 个大文件——`Video.ts` / `Command.ts`
- ⏳ **批 D（独立决策）**：`main.js` + index.html

#### Scenario: 批 C 2 个文件全部通过 typecheck
- **WHEN** 运行 `npm run typecheck`
- **THEN** tsconfig.json 检查 Video.ts 与 Command.ts 并通过，0 错（允许跨 main.js 边界处用 `// @ts-expect-error` 注明 change D 处理）

#### Scenario: 批 C 2 个文件无 @ts-nocheck
- **WHEN** grep 2 个文件的 `@ts-nocheck`
- **THEN** 无匹配

#### Scenario: 批 C 后前端测试仍全绿
- **WHEN** 运行 `npm test`
- **THEN** 61/61 全绿

### Requirement: 行为逐字不变（前端模块）
（同 frontend-modules 主 spec，批 C 2 个文件加入约束范围；本 change 不修业务 bug，仅类型化）

#### Scenario: 批 C 2 个文件 git diff 去掉类型后逐字一致
- **WHEN** 对 2 个文件运行 `git diff`，去掉所有类型标注后
- **THEN** 可执行代码部分与重构前逐字一致（含样式代码完全不动）
