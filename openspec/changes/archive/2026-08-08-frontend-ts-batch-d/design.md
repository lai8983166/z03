## Context

main.js 是前端入口（index.html 引用），含：
- `Utils` 对象（10 个 DOM 表格操作方法）
- `setLEDStatus(elementId, isActive)`
- `initializeLEDIndicators` / `initializeRadioGroups` / `initializeTables`
- `window.showTab` / `window.wsClient` 等运行时全局
- DOMContentLoaded handler（启动流程）

下游模块（Infrared.ts/Laser.ts/Telemeter.ts/Command.ts 等）import `{ Utils, setLEDStatus } from "../main"` —— 当前 TS 推断为 any（main.js 无类型）。

约束：测试 mock / 不改样式代码 / 遗留代码保留。

## Goals / Non-Goals

**Goals:**
- main.ts 加完整类型，下游 import 享受类型
- index.html src 改 1 行（用户授权）
- typecheck 0 错 / test 120/120

**Non-Goals:**
- 不改样式代码（element.style.X 赋值逐字保留）
- 不改 DOM 操作语义
- 不修业务 bug
- 不改其他文件（除非 import 类型推断失配）

## Decisions

### D1: Utils 用对象类型 + 方法签名

**决定**：Utils 是对象字面量（不是 class），加 `export const Utils: { method1(...): T; ... }` 形式的类型标注。或定义 `interface UtilsType` 然后 `export const Utils: UtilsType = {...}`。

**理由**：对象字面量加方法签名，TS 能精确推断每个方法的参数与返回类型。

### D2: DOM narrowing 用 as 断言

**决定**：`document.getElementById(tableId) as HTMLTableElement | null` + `if (!table) return` 守卫。访问 `.rows[row].cells[col]` 时 TS 知道是 HTMLTableElement。

### D3: window 全局用 declare global

**决定**：文件顶部加 `declare global { interface Window { showTab(index: number): void; wsClient?: WebSocketClient; isBlackboxReplaying?: boolean; isBlackboxDrawing?: boolean; } }`。

**注意**：WebSocketClient 类型来自 js/Client.ts 的 default export。

### D4: 样式代码逐字保留

**决定**：所有 `element.style.X = "..."`、`td.contentEditable = "true"`、`td.style.cursor = "..."` 等**完全不动**。仅加类型标注让 TS 通过。

### D5: function() 回调的 this 处理

**决定**：line 76-81 / 151-156 用 `function() { this.style.X = ... }`。TS strict 下 noImplicitThis 可能报错。修复：
- 选项 A：改用箭头函数 + `e.target as HTMLElement`（改代码）
- 选项 B：保留 function() + 显式标 `this: HTMLElement`（加类型）

选 B（保留原 function 形式，加 this 类型）—— 最小改动。

### D6: 单 commit

## Risks / Trade-offs

- **[index.html 改 src 后 vite 不解析]** → 缓解：vite resolve.extensions 含 .ts，`./main` 会找到 main.ts；测试通过即证明
- **[noImplicitThis 触发大量错]** → 缓解：D5 用 `this: HTMLElement` 标注
- **[Utils 方法多导致类型标注冗长]** → 缓解：定义 `interface UtilsType` 集中声明
- **[window 全局类型跨文件影响]** → 缓解：declare global 仅在 main.ts，其他文件如 Infrared.ts 用 window.isBlackboxReplaying 时也能看到类型
