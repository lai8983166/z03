# Tasks: frontend-ts-batch-c（2 个大前端 JS → TS）

> 全局约定：每个 change 一个 git commit；测试 mock；不改 index.html/style.css/JS 样式；遗留代码保留；**不修业务 bug**（仅类型化）。本 change 是前端 TS 化第三批（大文件批）。

## 1. 准备（skill: eric-quality-control）

- [x] 1.1 `npm run typecheck` 确认基线 0 错
- [x] 1.2 `npm test` 确认基线 61/61

## 2. 批量 rename + 启动 agent（skill: eric-javascript + eric-backend）

- [x] 2.1 `git mv` 2 个 `.js` → `.ts`：Video / Command
- [x] 2.2 起 2 个 background agent，每个负责一个文件
- [x] 2.3 等 agent 完成

## 3. 全量验证 + 修剩余（skill: eric-quality-control）

- [x] 3.1 `npm run typecheck` → 列剩余错
- [x] 3.2 修剩余（agent 之间冲突、跨文件 import 推断）
- [x] 3.3 `npm test` 通过

## 4. 审计

- [x] 4.1 grep 复核：2 个文件无 `@ts-nocheck`；`as any`/`: any` 0；`@ts-expect-error` 仅必要时 + 注明原因
- [x] 4.2 `git diff` 复核：可执行代码逐字不变（特别检查无 `=` → `==` 之类的 bug 修复）
- [x] 4.3 复核约束：index.html / style.css 未动；测试断言未改

## 5. eric-review + 提交

- [x] 5.1 eric-review 自查（重点：agent 是否引入了非类型化改动，如 CodeUpload 那种 bug fix）
- [x] 5.2 `git commit`
- [x] 5.3 `git push`
