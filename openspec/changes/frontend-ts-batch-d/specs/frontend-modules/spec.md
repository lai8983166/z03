# Spec Delta: frontend-modules（批 D 入口迁移）

> 本 change 把 frontend-modules capability 的批 D（main.js + index.html 入口）迁移到 .ts。

## MODIFIED Requirements

### Requirement: 前端业务模块以 .ts 形式存在并提供完整 TS 类型
项目 `js/` 下的前端业务模块 + 根目录 `main.ts`（入口）MUST 以 `.ts` 形式存在，提供完整 TypeScript 类型。迁移按规模分批进行：
- ✅ **批 A（frontend-ts-batch-a，已完成）**：8 个小文件
- ✅ **批 B（frontend-ts-batch-b，已完成）**：5 个中等文件
- ✅ **批 C（frontend-ts-batch-c，已完成）**：2 个大文件（Video/Command）
- ✅ **批 D（本 change）**：入口 `main.ts`（449 行）+ index.html src 更新

#### Scenario: 批 D 后 main.ts 通过 typecheck
- **WHEN** 运行 `npm run typecheck`
- **THEN** tsconfig.json 检查 main.ts 并通过，0 错

#### Scenario: 下游 import Utils 享受类型
- **WHEN** 在 Infrared.ts / Laser.ts / Telemeter.ts 等 import `{ Utils }` 后访问 `Utils.setTableCellText(...)`
- **THEN** TS 能识别参数类型（tableId: string, row: number, col: number, text: string）

#### Scenario: index.html 入口仍可加载
- **WHEN** vite dev/build 处理 index.html 的 `<script src="./main">`
- **THEN** vite 自动解析到 main.ts，前端正常加载

### Requirement: index.html src 路径更新（仅 1 行，非样式）
index.html 的入口 script src 从 `./main.js` 改为 `./main`（无后缀，让 vite 自动解析 .ts）。其他 index.html 内容（HTML 结构、内联样式、其他 script）MUST 完全不动。

#### Scenario: 仅 src 路径改变
- **WHEN** `git diff index.html`
- **THEN** 只有 `<script src="./main.js" ...>` → `<script src="./main" ...>` 一行变化，其他行逐字不变

### Requirement: 样式代码逐字不变（约束重申）
main.ts 内的所有样式代码（element.style.X 赋值、contentEditable、cursor、backgroundColor、border 等）MUST 逐字保留。仅加类型标注、DOM narrowing、`this: HTMLElement` 标注，不改任何样式赋值。

#### Scenario: main.ts 样式代码逐字一致
- **WHEN** 对 main.ts 运行 `git diff`，去掉类型标注后
- **THEN** 所有 element.style.X = "..." 赋值与重构前逐字一致
