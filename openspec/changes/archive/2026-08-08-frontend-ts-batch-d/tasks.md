# Tasks: frontend-ts-batch-d（main.js + index.html 入口 TS 化）

> 全局约定：每个 change 一个 git commit；测试 mock；不改 index.html/style.css/JS 样式代码；遗留代码保留。本 change 用户授权改 index.html 的 1 行 script src（非样式）。

## 1. 准备

- [x] 1.1 `npm run typecheck` 确认基线 0 错
- [x] 1.2 `npm test` 确认基线 120/120

## 2. rename + index.html

- [x] 2.1 `git mv main.js main.ts`
- [x] 2.2 改 index.html line 12：`src="./main.js"` → `src="./main"`
- [x] 2.3 tsconfig include 加 `main.ts`（或 `"*.ts"` 通配）

## 3. main.ts 类型化

- [x] 3.1 顶部加 `declare global { interface Window { showTab(index: number): void; wsClient?: typeof import("./js/Client").default; isBlackboxReplaying?: boolean; isBlackboxDrawing?: boolean; } }`
- [x] 3.2 `AppState` interface + 标注
- [x] 3.3 定义 `interface UtilsType`，给 Utils 加类型（10 个方法签名）
- [x] 3.4 `setLEDStatus(elementId: string, isActive: boolean): void`
- [x] 3.5 DOM narrowing：document.getElementById(tableId) as HTMLTableElement | null；if (!table) return 守卫
- [x] 3.6 function() 回调加 `this: HTMLElement` 标注（D5）
- [x] 3.7 跑 typecheck，修暴露错

## 4. 验证

- [x] 4.1 `npm run typecheck` 0 错
- [x] 4.2 `npm test` 通过 120/120
- [x] 4.3 `git diff index.html` 复核：仅 src 路径变化
- [x] 4.4 `git diff main.ts` 复核：样式代码（element.style.X）逐字不变
- [x] 4.5 grep 复核 `as any` / `: any` 0；`@ts-expect-error` 仅必要时

## 5. eric-review + 提交

- [x] 5.1 eric-review 自查（重点：样式代码完全未动、index.html 仅 src 变、declare global 完整）
- [x] 5.2 `git commit`
- [x] 5.3 `git push`
