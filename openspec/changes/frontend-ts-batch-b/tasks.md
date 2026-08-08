# Tasks: frontend-ts-batch-b（5 个中等前端 JS → TS）

> 全局约定：每个 change 一个 git commit；测试 mock；不改 index.html/style.css/JS 样式；遗留代码保留。本 change 是前端 TS 化第二批（中等文件批）。设计沿用批 A 的 D1-D7。

## 1. 准备（skill: eric-quality-control）

- [x] 1.1 `npm run typecheck` 确认基线 0 错
- [x] 1.2 `npm test` 确认基线 61/61
- [x] 1.3 grep 复核 5 个文件被引用情况（应该都已无 .js 后缀）

## 2. 批量 rename + 启动 agent（skill: eric-javascript + eric-backend）

- [x] 2.1 `git mv` 5 个 `.js` → `.ts`：YC / ImageUpload / DataRouter / CodeUpload / TurntableControl
- [x] 2.2 起 5 个 background agent，每个负责一个文件：Read → 加类型（DOM narrowing、参数标注、事件 payload interface）→ 跑 typecheck（grep 自己文件）→ 报告
- [x] 2.3 等 5 个 agent 完成通知

## 3. 全量验证 + 修剩余（skill: eric-quality-control）

- [x] 3.1 `npm run typecheck`（全量）→ 列出剩余错
- [x] 3.2 修剩余错（agent 之间冲突、跨文件 import 类型推断失配）
- [x] 3.3 `npm test` 通过（61/61）

## 4. 审计（skill: eric-quality-control）

- [x] 4.1 grep 复核：5 个文件无 `@ts-nocheck`；`as any` 全 0；`: any` 仅跨 .js 边界必要时 + 注明原因；`@ts-expect-error` 注明 change C 处理
- [x] 4.2 `git diff` 复核：可执行代码逐字不变；样式代码完全未动
- [x] 4.3 复核约束：index.html / style.css 未动；测试断言未改

## 5. eric-review + 提交（skill: eric-review）

- [x] 5.1 eric-review 自查
- [x] 5.2 `git commit`（含 rename + 类型）
- [x] 5.3 `git push`
