## Why

前端 TS 化批 A/B/C 完成了 js/ 下 15 个业务模块。本 change 是**最后一批**（批 D），覆盖前端入口 `main.js`（449 行）。完成后全前端 .ts 化（含入口），仅剩调试文件（test_*.js / script.js）保留为 .js。

main.js 是 index.html 入口（`<script src="./main.js" type="module">`），导出 `Utils` 工具对象 + `setLEDStatus`，下游模块（Infrared/Laser/Telemeter 等）import 它们。当前 TS 看不到类型，下游全是 any 推断。

## What Changes

- rename `main.js` → `main.ts` + 完整 TS 类型：
  - `AppState` interface（currentTab）
  - `Utils` 对象方法签名（loadCSVToTable / getEditableCellsAsPositionMap / setEditableCells / parseCSV / saveTableToCSV / setTableCellReadonly / centerAlignTable / stretchTableColumns / setCellWidget / setTableCellText / getTableCellText）
  - `setLEDStatus(elementId: string, isActive: boolean): void`
  - `declare global { interface Window { showTab, wsClient, isBlackboxReplaying, ... } }`（运行时挂载的全局）
  - DOM narrowing（document.getElementById(...) as HTMLTableElement 等）
- **改 index.html 1 行**：`src="./main.js"` → `src="./main"`（用户授权，非样式改动）
- tsconfig include 加 `main.ts`
- **样式代码逐字不变**：所有 `element.style.X = "..."` 赋值保留（约束：样式行为逐字保持）

## Capabilities

### New Capabilities
（无）

### Modified Capabilities
- `frontend-modules`: 批 D main.ts 加入"已完成"；批 A/B/C/D 共 16 文件全 TS 化（含入口）

## Impact

- **rename**：main.js → main.ts
- **代码**：main.ts 加类型（DOM narrowing、方法签名、declare global）；下游 import { Utils } 现在能享受类型
- **index.html**：改 1 行 src（非样式）
- **配置**：tsconfig include 加 main.ts
- **构建/CI**：typecheck 0 错；test 120/120
- **运行时**：零影响（vite 自动解析 ./main 到 main.ts）
- **样式**：完全不动（element.style.X 逐字保留）
